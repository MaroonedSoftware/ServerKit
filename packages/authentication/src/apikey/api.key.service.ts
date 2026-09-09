import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from 'injectkit';
import { DateTime, Duration } from 'luxon';
import { httpError } from '@maroonedsoftware/errors';
import { CacheProvider } from '@maroonedsoftware/cache';
import { Logger } from '@maroonedsoftware/logger';
import { PolicyService, isPolicyResultDenied } from '@maroonedsoftware/policies';
import { invalidAuthenticationSession, type AuthenticationSession } from '../types.js';
import type { AuthorizationScheme } from '../authentication.handler.js';
import type { TargetActor } from '../mfa/types.js';
import { ApiKeyRepository, type ApiKeyListOptions } from './api.key.repository.js';
import { apiKeyHint, encodeBase62, formatApiKeyToken, hashApiKeyToken, parseApiKeyToken } from './api.key.token.js';
import type { ApiKey, ApiKeyCreateInput, ApiKeyIssued, ApiKeySessionClaim, ApiKeyUpdate, ApiKeyValidation } from './types.js';

/** Cache key prefix for the `lastUsedAt` write throttle. */
const TOUCH_KEY_PREFIX = 'api_key_touched_';

/**
 * Configuration for {@link ApiKeyService} and
 * {@link import('./api.key.authentication.handler.js').ApiKeyAuthenticationHandler}.
 *
 * Register with `useValue` to override any of it:
 *
 * ```ts
 * registry.register(ApiKeyServiceOptions).useValue(new ApiKeyServiceOptions('acme', 32, undefined, undefined, undefined, ['bearer', 'apikey']));
 * ```
 */
@Injectable()
export class ApiKeyServiceOptions {
  constructor(
    /**
     * Vendor prefix every token carries, e.g. `'sk'` → `sk_live_…`. Base62
     * characters only. Pick something distinctive: it is what lets the handler
     * decline another service's bearer token for free, and what a secret
     * scanner matches on.
     */
    public readonly prefix: string = 'sk',
    /** Entropy in the token body. 32 bytes is 256 bits; below 16 is not defensible. */
    public readonly secretBytes: number = 32,
    /**
     * Longest lifetime a key may be issued with. `create` refuses an `expiresAt`
     * beyond it. Undefined allows non-expiring keys.
     */
    public readonly maxLifetime?: Duration,
    /**
     * Lifetime of the ad-hoc session minted for a key-authenticated request.
     * Short by design: the session is per request and never persisted, so this
     * only bounds how long a downstream consumer may treat it as fresh.
     */
    public readonly sessionLifetime: Duration = Duration.fromObject({ minutes: 5 }),
    /**
     * Minimum gap between `lastUsedAt` writes for one key. Without it a busy
     * key turns every request into a database write.
     */
    public readonly lastUsedWriteInterval: Duration = Duration.fromObject({ minutes: 5 }),
    /**
     * Authorization schemes the handler answers to, lowercase.
     *
     * `Bearer` by default, because every HTTP client and SDK already speaks it.
     * Add `'apikey'` for `Authorization: ApiKey sk_…`, which reads more
     * honestly and lets the scheme map dispatch straight to this handler
     * without a chain.
     */
    public readonly schemes: ReadonlyArray<AuthorizationScheme> = ['bearer'],
  ) {}
}

/**
 * Issues, validates, rotates, and revokes API keys.
 *
 * The token is generated once and never stored: only its SHA-256 and its
 * leading characters are. A lost token cannot be recovered, only
 * {@link rotate}d.
 *
 * Validation is deliberately cheap — a checksum test, then one indexed read,
 * then a policy call — because it runs on every machine request. There is no
 * validation cache, which is what makes {@link revoke} take effect on the next
 * request rather than at the end of a TTL.
 *
 * The service does not own an HTTP surface. Wire {@link create}, {@link listForOwner},
 * {@link rotate}, and {@link revoke} to your own routes, and mount
 * {@link import('./api.key.authentication.handler.js').ApiKeyAuthenticationHandler}
 * to authenticate with them.
 */
@Injectable()
export class ApiKeyService<K extends string = string> {
  constructor(
    private readonly options: ApiKeyServiceOptions,
    private readonly repository: ApiKeyRepository<K>,
    private readonly cache: CacheProvider,
    private readonly policyService: PolicyService,
    private readonly logger: Logger,
  ) {}

  /**
   * Issue a new key.
   *
   * @param input - Owner, label, and optional type, scopes, metadata, and expiry.
   * @returns The stored record and the plaintext token. **The only time the
   *   token exists** — show it to the user once and discard it.
   * @throws HTTP 403 when `'auth.api.key.allowed'` denies.
   * @throws HTTP 400 when `expiresAt` is in the past or beyond
   *   {@link ApiKeyServiceOptions.maxLifetime}.
   */
  async create(input: ApiKeyCreateInput<K>): Promise<ApiKeyIssued<K>> {
    await this.assertPolicy('create', input.owner);

    const createdAt = DateTime.utc();
    this.assertExpiry(input.expiresAt, createdAt);

    const token = formatApiKeyToken({
      prefix: this.options.prefix,
      type: input.type,
      body: encodeBase62(randomBytes(this.options.secretBytes)),
    });

    const key: ApiKey<K> = {
      id: randomUUID(),
      owner: input.owner,
      name: input.name,
      ...(input.type === undefined ? {} : { type: input.type }),
      hint: apiKeyHint(token),
      secretHash: hashApiKeyToken(token),
      scopes: input.scopes ?? [],
      metadata: input.metadata ?? {},
      createdAt,
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
    };

    const stored = await this.repository.create(key);

    this.logger.info('api_key.created', {
      id: stored.id,
      actorId: stored.owner.actorId,
      hint: stored.hint,
      expiresAt: stored.expiresAt?.toISO() ?? undefined,
    });

    return { key: stored, token };
  }

  /**
   * Check a presented token.
   *
   * Returns a discriminated result rather than throwing, because the
   * {@link import('../authentication.handler.js').AuthenticationHandler}
   * contract needs "not a valid credential" to be a value: a handler that
   * throws stops the whole chain, so a bad API key would prevent a JWT behind
   * it from ever being tried.
   *
   * The checksum test runs first and costs no I/O, so a JWT arriving at this
   * handler is declined without a storage round trip.
   *
   * @param token - The presented credential.
   * @returns `{ kind: 'valid', key }`, or `{ kind: 'invalid', reason }`.
   */
  async validate(token: string): Promise<ApiKeyValidation<K>> {
    if (!parseApiKeyToken(token, this.options.prefix)) {
      // Every non-key bearer credential lands here, so this is the ordinary
      // case behind a chain, not a signal. `debug`, never `warn`.
      this.logger.debug('api_key.rejected', { reason: 'malformed' });
      return { kind: 'invalid', reason: 'malformed' };
    }

    const key = await this.repository.findBySecretHash(hashApiKeyToken(token));
    if (!key) {
      this.logger.debug('api_key.rejected', { reason: 'unknown' });
      return { kind: 'invalid', reason: 'unknown' };
    }

    const now = DateTime.utc();

    // A revoked or expired key is a real signal: someone is still holding a
    // credential that was withdrawn, which is worth seeing in a log.
    if (key.revokedAt) {
      this.logger.warn('api_key.rejected', { id: key.id, actorId: key.owner.actorId, reason: 'revoked' });
      return { kind: 'invalid', reason: 'revoked' };
    }

    if (key.expiresAt && key.expiresAt <= now) {
      this.logger.warn('api_key.rejected', { id: key.id, actorId: key.owner.actorId, reason: 'expired' });
      return { kind: 'invalid', reason: 'expired' };
    }

    const policyResult = await this.policyService.check('auth.api.key.allowed', { owner: key.owner, operation: 'validate', key });
    if (isPolicyResultDenied(policyResult)) {
      this.logger.warn('api_key.rejected', { id: key.id, actorId: key.owner.actorId, reason: 'policy_denied', policyReason: policyResult.reason });
      return { kind: 'invalid', reason: 'policy_denied' };
    }

    await this.touchLastUsed(key, now);

    return { kind: 'valid', key };
  }

  /**
   * Validate a token and mint a session for it.
   *
   * The session is ad-hoc and unpersisted, like the one
   * `McpAuthenticationHandler` builds: `sessionToken` is random and references
   * nothing stored, so it can never be mistaken for a revocable session key,
   * and the lifetime is the shorter of
   * {@link ApiKeyServiceOptions.sessionLifetime} and the key's own expiry.
   *
   * It carries exactly one factor, `{ method: 'apikey', kind: 'possession' }`.
   * One factor fails `DefaultMfaSatisfiedPolicy`, which is `requirePolicy()`'s
   * default — so a key cannot reach an MFA-gated route by accident. Machine
   * routes opt in with `API_KEY_SESSION_POLICY` or
   * `MFA_SATISFIED_OR_API_KEY_POLICY`.
   *
   * @param token - The presented credential.
   * @returns A session, or `invalidAuthenticationSession` when the token does
   *   not validate.
   */
  async authenticate(token: string): Promise<AuthenticationSession> {
    const result = await this.validate(token);
    if (result.kind === 'invalid') return invalidAuthenticationSession;

    const { key } = result;
    const issuedAt = DateTime.utc();
    const sessionExpiry = issuedAt.plus(this.options.sessionLifetime);

    const claim: ApiKeySessionClaim<K> = {
      id: key.id,
      name: key.name,
      ...(key.type === undefined ? {} : { type: key.type }),
      owner: key.owner,
      scopes: key.scopes,
      metadata: key.metadata,
    };

    return {
      subject: key.owner.actorId,
      // Random, never derived from the token: a session token is logged in
      // places a credential must never reach.
      sessionToken: randomUUID(),
      issuedAt,
      lastAccessedAt: issuedAt,
      // Never outlive the key itself, so a session minted moments before expiry
      // does not extend it.
      expiresAt: key.expiresAt && key.expiresAt < sessionExpiry ? key.expiresAt : sessionExpiry,
      factors: [{ issuedAt, authenticatedAt: issuedAt, method: 'apikey', methodId: key.id, kind: 'possession' }],
      claims: { apiKey: claim },
    };
  }

  /** Retrieve a key by id, or `undefined` when none exists. */
  async get(id: string): Promise<ApiKey<K> | undefined> {
    return this.repository.findById(id);
  }

  /** List an owner's keys. Active only unless `options.includeInactive` is set. */
  async listForOwner(owner: TargetActor<K>, options?: ApiKeyListOptions): Promise<ApiKey<K>[]> {
    return this.repository.listByOwner(owner, options);
  }

  /**
   * Change a key's label, scopes, metadata, or expiry.
   *
   * Pass `expiresAt: null` to clear an expiry; omit the field to leave it alone.
   *
   * @throws HTTP 404 when the id is unknown.
   * @throws HTTP 400 when the new `expiresAt` is in the past or beyond
   *   {@link ApiKeyServiceOptions.maxLifetime}.
   */
  async update(id: string, patch: ApiKeyUpdate): Promise<ApiKey<K>> {
    const existing = await this.requireKey(id);

    if (patch.expiresAt) this.assertExpiry(patch.expiresAt, DateTime.utc());

    const updated = await this.repository.update(existing.id, patch);
    this.logger.info('api_key.updated', { id: updated.id, actorId: updated.owner.actorId });

    return updated;
  }

  /**
   * Issue a fresh token for an existing key, invalidating the old one immediately.
   *
   * Keeps the id, owner, type, scopes, and metadata, so anything referencing the
   * key by id keeps working. This is the only remedy for a leaked or lost token.
   *
   * @throws HTTP 404 when the id is unknown.
   * @throws HTTP 409 when the key has been revoked — rotating a withdrawn key
   *   would quietly bring it back.
   */
  async rotate(id: string): Promise<ApiKeyIssued<K>> {
    const existing = await this.requireKey(id);

    if (existing.revokedAt) {
      throw httpError(409)
        .withDetails({ id: 'key has been revoked' })
        .withInternalDetails({ message: `refusing to rotate revoked api key ${id}` });
    }

    const token = formatApiKeyToken({
      prefix: this.options.prefix,
      type: existing.type,
      body: encodeBase62(randomBytes(this.options.secretBytes)),
    });

    const updated = await this.repository.update(existing.id, { secretHash: hashApiKeyToken(token), hint: apiKeyHint(token) });
    this.logger.info('api_key.rotated', { id: updated.id, actorId: updated.owner.actorId, hint: updated.hint });

    return { key: updated, token };
  }

  /**
   * Withdraw a key. Takes effect on the next request, since nothing is cached.
   *
   * The record is kept so a key list can show what was withdrawn and when.
   * {@link delete} is the hard-delete.
   *
   * @throws HTTP 404 when the id is unknown.
   */
  async revoke(id: string): Promise<ApiKey<K>> {
    const existing = await this.requireKey(id);
    const revoked = await this.repository.revoke(existing.id, DateTime.utc());

    this.logger.info('api_key.revoked', { id: revoked.id, actorId: revoked.owner.actorId });

    return revoked;
  }

  /**
   * Withdraw every active key an owner holds.
   *
   * Call this whenever an actor loses access — blocked, suspended, deleted, or
   * removed from the organisation the keys were scoped to. Nothing else in this
   * package knows about your account lifecycle, so a key outlives a deleted
   * user unless you call it.
   *
   * @returns How many keys were revoked.
   */
  async revokeAllForOwner(owner: TargetActor<K>): Promise<number> {
    const count = await this.repository.revokeAllForOwner(owner, DateTime.utc());

    this.logger.info('api_key.revoked_all', { actorId: owner.actorId, organizationId: owner.organizationId, count });

    return count;
  }

  /**
   * Permanently remove a key, losing the record that it ever existed.
   *
   * Prefer {@link revoke} for anything a user does; this is the administrative
   * hard-delete. No-op when the id is unknown.
   */
  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
    this.logger.info('api_key.deleted', { id });
  }

  /** Fetch a key or raise a 404, so management methods share one error shape. */
  private async requireKey(id: string): Promise<ApiKey<K>> {
    const key = await this.repository.findById(id);
    if (!key) {
      throw httpError(404)
        .withDetails({ id: 'not found' })
        .withInternalDetails({ message: `api key ${id} not found` });
    }
    return key;
  }

  /** Reject an expiry in the past or beyond the configured ceiling. */
  private assertExpiry(expiresAt: DateTime | undefined, now: DateTime): void {
    if (!expiresAt) return;

    if (expiresAt <= now) {
      throw httpError(400).withDetails({ expiresAt: 'must be in the future' });
    }

    const { maxLifetime } = this.options;
    if (maxLifetime && expiresAt > now.plus(maxLifetime)) {
      throw httpError(400)
        .withDetails({ expiresAt: `must be within ${maxLifetime.toHuman()}` })
        .withInternalDetails({ maxLifetime: maxLifetime.toISO() });
    }
  }

  /**
   * Record a successful validation, at most once per throttle window.
   *
   * `cache.add` is set-if-absent, so the first request in a window claims the
   * write and the rest skip it. `lastUsedAt` is a "when was this last seen"
   * signal for a key list, not an audit log — trading exactness for one write
   * per window instead of one per request is the right side of that.
   *
   * Failures are swallowed: a cache outage must not turn a valid key into a
   * failed request.
   */
  private async touchLastUsed(key: ApiKey<K>, now: DateTime): Promise<void> {
    try {
      const claimed = await this.cache.add(`${TOUCH_KEY_PREFIX}${key.id}`, '1', { ttl: this.options.lastUsedWriteInterval });
      if (!claimed) return;

      await this.repository.touchLastUsed(key.id, now);
    } catch (error) {
      this.logger.warn('api_key.touch_failed', { id: key.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  /** Run `'auth.api.key.allowed'` and convert a denial into a 403. */
  private async assertPolicy(operation: 'create' | 'validate', owner: TargetActor<K>): Promise<void> {
    const result = await this.policyService.check('auth.api.key.allowed', { owner, operation });

    if (isPolicyResultDenied(result)) {
      throw httpError(403)
        .withDetails({ reason: result.reason })
        .withInternalDetails({ message: `auth.api.key.allowed denied ${operation} for actor ${owner.actorId}`, ...(result.details ?? {}) });
    }
  }
}
