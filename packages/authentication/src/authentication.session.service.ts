import { Injectable } from 'injectkit';
import { unauthorizedError } from '@maroonedsoftware/errors';
import { DateTime, Duration } from 'luxon';
import { deepmergeCustom } from 'deepmerge-ts';
import { Logger } from '@maroonedsoftware/logger';
import {
  AuthenticationSession,
  AuthenticationSessionFactor,
  AuthenticationToken,
  SessionRevocationReason,
} from './types.js';
import type { AuthenticationSessionHooks } from './types.js';
import { CacheProvider } from '@maroonedsoftware/cache';
import { JwtProvider } from './providers/jwt.provider.js';

/**
 * Minimum TTL applied to a consumed-jti sentinel to absorb small clock skew
 * between the token issuer and any verifier. The effective TTL is
 * `max(remaining-token-lifetime, MIN_CONSUMED_TTL_SECONDS)`.
 */
const MIN_CONSUMED_TTL_SECONDS = 60;

/**
 * Internal shape of the refresh-token family blob persisted to cache. Stored as
 * a JSON string under `auth_refresh_family_{familyId}` so the implementation
 * does not depend on Redis SET primitives — the abstract {@link CacheProvider}
 * only exposes string get/set/update/delete.
 */
interface RefreshFamilyBlob {
  /** Every refresh-token `jti` ever issued in this family. */
  jtis: string[];
  /** Currently-active session tokens that are bound to this family. */
  sessionTokens: string[];
}

/**
 * Payload claims embedded in a session-level refresh-token JWT.
 */
interface RefreshTokenPayload {
  /** Discriminator distinguishing refresh tokens from access tokens. */
  kind: 'refresh';
  /** Unique per-issuance identifier; rotated on every refresh. */
  jti: string;
  /** Identifier shared across every rotation in this chain. */
  familyId: string;
  /** Session this refresh token is bound to. */
  sessionToken: string;
}

/**
 * Configuration options for {@link AuthenticationSessionService}.
 */
@Injectable()
export class AuthenticationSessionServiceOptions {
  constructor(
    /** The `iss` claim value to embed in issued JWTs (e.g. `"https://auth.example.com"`). */
    public readonly issuer: string,
    /** The `aud` claim value(s) to embed in issued JWTs. */
    public readonly audience: string | string[],
    /** Default session and access-token lifetime when no per-call expiration is provided. */
    public readonly expiresIn: Duration,
    /**
     * Lifetime of session-level refresh tokens. Defaults to 30 days when
     * unspecified. Refresh tokens are JWTs and the family-tracking cache
     * entries inherit this TTL, refreshed on every rotation.
     */
    public readonly refreshExpiresIn: Duration = Duration.fromObject({ days: 30 }),
    /**
     * Optional lifecycle callbacks fired after session writes/deletes commit.
     * See {@link AuthenticationSessionHooks} for individual hook semantics.
     */
    public readonly hooks: AuthenticationSessionHooks = {},
  ) {}
}

/**
 * Manages server-side authentication sessions backed by a {@link CacheProvider}.
 *
 * A session is the canonical record of an authenticated actor. JWTs are
 * short-lived signed references to a session; revoking the session invalidates
 * all tokens derived from it regardless of their individual expiry claims.
 *
 * @example
 * ```typescript
 * const session = await sessionService.createSession(userId, { plan: 'pro' }, passwordFactor);
 * const { accessToken, refreshToken } = await sessionService.issueTokenForSession(session.sessionToken);
 * ```
 */
@Injectable()
export class AuthenticationSessionService {
  constructor(
    private readonly options: AuthenticationSessionServiceOptions,
    private readonly cache: CacheProvider,
    private readonly jwtProvider: JwtProvider,
    private readonly logger: Logger,
  ) {}

  private getSessionKey(id: string) {
    return `auth_session_${id}`;
  }

  private getSubjectKey(id: string) {
    return `auth_session_subject_${id}`;
  }

  private getFamilyKey(familyId: string) {
    return `auth_refresh_family_${familyId}`;
  }

  private getConsumedKey(jti: string) {
    return `auth_refresh_consumed_${jti}`;
  }

  private serializeSession(session: AuthenticationSession): string {
    return JSON.stringify({
      sessionToken: session.sessionToken,
      subject: session.subject,
      issuedAt: session.issuedAt.toUnixInteger(),
      expiresAt: session.expiresAt.toUnixInteger(),
      lastAccessedAt: session.lastAccessedAt.toUnixInteger(),
      factors: session.factors.map(factor => ({
        method: factor.method,
        methodId: factor.methodId,
        kind: factor.kind,
        issuedAt: factor.issuedAt.toUnixInteger(),
        authenticatedAt: factor.authenticatedAt.toUnixInteger(),
      })),
      claims: session.claims,
      familyId: session.familyId,
    });
  }

  private deserializeSession(data: string): AuthenticationSession {
    const session = JSON.parse(data);
    return {
      sessionToken: session.sessionToken,
      subject: session.subject,
      issuedAt: DateTime.fromSeconds(session.issuedAt),
      expiresAt: DateTime.fromSeconds(session.expiresAt),
      lastAccessedAt: DateTime.fromSeconds(session.lastAccessedAt),
      factors: session.factors.map((factor: Record<string, unknown>) => ({
        method: factor.method,
        methodId: factor.methodId,
        kind: factor.kind,
        issuedAt: DateTime.fromSeconds(factor.issuedAt as number),
        authenticatedAt: DateTime.fromSeconds(factor.authenticatedAt as number),
      })),
      claims: session.claims,
      familyId: session.familyId,
    };
  }

  private async runHook<T extends keyof AuthenticationSessionHooks>(
    name: T,
    invoke: (hook: NonNullable<AuthenticationSessionHooks[T]>) => Promise<void> | void,
  ) {
    const hook = this.options.hooks[name];
    if (!hook) return;
    try {
      await invoke(hook as NonNullable<AuthenticationSessionHooks[T]>);
    } catch (ex) {
      this.logger.error(`Authentication hook ${String(name)} threw; ignoring`, ex);
    }
  }

  private async readFamily(familyId: string): Promise<{ blob: RefreshFamilyBlob; existed: boolean }> {
    const raw = await this.cache.get(this.getFamilyKey(familyId));
    if (!raw) {
      return { blob: { jtis: [], sessionTokens: [] }, existed: false };
    }
    let parsed: Partial<RefreshFamilyBlob> = {};
    try {
      parsed = JSON.parse(raw) as Partial<RefreshFamilyBlob>;
    } catch {
      // Corrupt entry — fall through and treat as empty so we don't crash auth.
    }
    return {
      blob: {
        jtis: Array.isArray(parsed.jtis) ? parsed.jtis : [],
        sessionTokens: Array.isArray(parsed.sessionTokens) ? parsed.sessionTokens : [],
      },
      existed: true,
    };
  }

  private async writeFamily(familyId: string, blob: RefreshFamilyBlob, exists: boolean) {
    const key = this.getFamilyKey(familyId);
    const serialized = JSON.stringify(blob);
    if (exists) {
      await this.cache.update(key, serialized, this.options.refreshExpiresIn);
    } else {
      await this.cache.set(key, serialized, this.options.refreshExpiresIn);
    }
  }

  private async addJtiToFamily(familyId: string, jti: string, sessionToken: string) {
    const { blob, existed } = await this.readFamily(familyId);
    if (!blob.jtis.includes(jti)) blob.jtis.push(jti);
    if (!blob.sessionTokens.includes(sessionToken)) blob.sessionTokens.push(sessionToken);
    await this.writeFamily(familyId, blob, existed);
  }

  private async removeSessionFromFamily(familyId: string, sessionToken: string) {
    const { blob, existed } = await this.readFamily(familyId);
    if (!existed) return;
    const idx = blob.sessionTokens.indexOf(sessionToken);
    if (idx > -1) blob.sessionTokens.splice(idx, 1);
    if (blob.sessionTokens.length === 0) {
      await this.cache.delete(this.getFamilyKey(familyId));
    } else {
      await this.cache.update(this.getFamilyKey(familyId), JSON.stringify(blob), this.options.refreshExpiresIn);
    }
  }

  private mintRefreshToken(session: AuthenticationSession): { token: string; jti: string; familyId: string } {
    if (!session.familyId) {
      throw unauthorizedError('Bearer error="invalid_token"').withInternalDetails({
        message: `session ${session.sessionToken} has no familyId; cannot mint refresh token`,
      });
    }
    const jti = crypto.randomUUID();
    const payload: RefreshTokenPayload = {
      kind: 'refresh',
      jti,
      familyId: session.familyId,
      sessionToken: session.sessionToken,
    };
    const { token } = this.jwtProvider.create(
      payload,
      session.subject,
      this.options.issuer,
      this.options.audience,
      this.options.refreshExpiresIn,
    );
    return { token, jti, familyId: session.familyId };
  }

  /**
   * Create a new session and store it in cache. A fresh `familyId` is minted
   * for the session so subsequent refresh-token rotations can be tracked.
   *
   * @param subject    - The subject identifier (typically a user id).
   * @param claims     - Arbitrary key/value pairs to embed in tokens issued from this session.
   * @param factors    - One or more authentication factors that have been satisfied.
   * @param expiration - Session lifetime; defaults to {@link AuthenticationSessionServiceOptions.expiresIn}.
   * @returns The newly created {@link AuthenticationSession}.
   */
  async createSession(
    subject: string,
    claims: Record<string, unknown>,
    factors: AuthenticationSessionFactor | AuthenticationSessionFactor[],
    expiration?: Duration,
  ) {
    const sessionToken = crypto.randomUUID();
    const familyId = crypto.randomUUID();
    const now = DateTime.utc();
    expiration ??= this.options.expiresIn;

    const session: AuthenticationSession = {
      sessionToken: sessionToken,
      subject,
      issuedAt: now,
      expiresAt: now.plus(expiration),
      lastAccessedAt: now,
      factors: Array.isArray(factors) ? factors : [factors],
      claims,
      familyId,
    };

    await this.cache.set(this.getSessionKey(sessionToken), this.serializeSession(session), expiration);

    await this.ensureSubjectSession(subject, sessionToken, expiration);

    await this.runHook('onSessionCreated', hook => hook(session));

    return session;
  }

  /**
   * Update an existing session's claims and/or factors and extend its expiry.
   *
   * Claims are deep-merged into the existing session claims (arrays are de-duplicated).
   * For factors, an existing entry with the same `methodId` has its `authenticatedAt`
   * updated; a new `methodId` is appended.
   *
   * Use {@link AuthenticationSessionService.rotateSession} instead when the update
   * represents a privilege change (e.g. MFA step-up) — that flow mints a new
   * `sessionToken` and revokes the old one rather than mutating in place.
   *
   * @param sessionToken - The opaque session token from {@link AuthenticationSession.sessionToken}.
   * @param subject      - Must match the session's recorded subject; throws 401 otherwise.
   * @param expiration   - Additional time to extend the session by; defaults to {@link AuthenticationSessionServiceOptions.expiresIn}.
   * @param claims       - Additional claims to deep-merge into the session.
   * @param factor       - Factor to upsert into the session's factor list.
   * @returns The updated {@link AuthenticationSession}.
   * @throws 401 when the session does not exist or the subject does not match.
   */
  async updateSession(
    sessionToken: string,
    subject: string,
    expiration?: Duration,
    claims?: Record<string, unknown>,
    factor?: AuthenticationSessionFactor,
  ) {
    const session = await this.getSession(sessionToken);
    if (!session) {
      throw unauthorizedError('Bearer error="invalid_token"');
    }

    if (session.subject !== subject) {
      throw unauthorizedError('Bearer error="invalid_token"').withInternalDetails({
        message: `Session subject ${session.subject} does not match ${subject}`,
      });
    }

    const deepmerge = deepmergeCustom({
      mergeArrays: values => {
        try {
          const set = new Set(values.flat());
          return Array.from(set);
        } catch {
          return values.flat();
        }
      },
    });

    if (claims) {
      session.claims = deepmerge(session.claims, claims);
    }

    if (factor) {
      const found = session.factors.find(x => x.methodId === factor.methodId);
      if (found) {
        found.authenticatedAt = factor.authenticatedAt;
      } else {
        session.factors.push(factor);
      }
    }

    expiration ??= this.options.expiresIn;

    session.expiresAt = session.expiresAt.plus(expiration);
    session.lastAccessedAt = DateTime.utc();

    await this.cache.update(this.getSessionKey(sessionToken), this.serializeSession(session), expiration);
    await this.ensureSubjectSession(session.subject, sessionToken, expiration);

    return session;
  }

  /**
   * Create a new session or update an existing one, depending on whether a valid
   * `sessionToken` is provided and resolves to a cached session.
   *
   * @param sessionToken - Optional existing session token. If provided and the session
   *   still exists in cache, the session is updated; otherwise a new session is created.
   * @param subject      - Subject identifier for the session.
   * @param claims       - Claims to set or merge.
   * @param factor       - Factor to record on the session.
   * @param expiration   - Session lifetime override.
   * @returns The created or updated {@link AuthenticationSession}.
   */
  async createOrUpdateSession(
    sessionToken: string | undefined,
    subject: string,
    claims: Record<string, unknown>,
    factor: AuthenticationSessionFactor,
    expiration?: Duration,
  ) {
    if (sessionToken) {
      const session = await this.getSession(sessionToken);

      if (session) {
        return await this.updateSession(sessionToken, subject, expiration, claims, factor);
      }
    }

    return await this.createSession(subject, claims, factor, expiration);
  }

  /**
   * Validate a JWT and retrieve the session it references.
   *
   * Decodes and verifies the JWT, then looks up the embedded `sessionToken` in
   * cache and cross-checks that the session subject matches the JWT subject.
   *
   * @param jwt                 - The signed JWT string to validate.
   * @param ignoreJwtExpiration - When `true`, an expired JWT is still decoded
   *   (useful for refresh flows where the session itself controls expiry).
   * @returns An object containing the {@link AuthenticationSession} and the decoded JWT payload.
   * @throws 401 when the JWT is invalid, the session is not found, or the subjects don't match.
   */
  async lookupSessionFromJwt(jwt: string, ignoreJwtExpiration?: boolean) {
    const jwtPayload = this.jwtProvider.decode(jwt, this.options.issuer, ignoreJwtExpiration);
    if (!jwtPayload) {
      await this.runHook('onValidationFailed', hook => hook('', { reason: 'jwt_decode_failed' }));
      throw unauthorizedError('Bearer error="invalid_token"');
    }

    const session = await this.getSession(jwtPayload.sessionToken ?? '');

    if (!session) {
      await this.runHook('onValidationFailed', hook => hook(jwtPayload.sessionToken ?? '', { reason: 'session_not_found' }));
      throw unauthorizedError('Bearer error="invalid_token"').withInternalDetails({
        message: `unable to find session ${jwtPayload.sessionToken}`,
      });
    }

    if (session.subject !== jwtPayload.subject) {
      await this.runHook('onValidationFailed', hook =>
        hook(jwtPayload.sessionToken ?? '', { reason: 'subject_mismatch' }),
      );
      throw unauthorizedError('Bearer error="invalid_token"').withInternalDetails({
        message: `session ${jwtPayload.sessionToken} not valid for ${jwtPayload.subject}`,
      });
    }

    return { session, jwtPayload };
  }

  /**
   * Delete a session from cache, effectively revoking all tokens issued from it.
   * Also removes the session from its refresh-token family (if any) so the family
   * is cleaned up when its last session is gone. Does nothing if the session does
   * not exist.
   *
   * @param sessionToken - The opaque session token to delete.
   * @param reason       - The reason this session is being revoked; surfaced to
   *   `onSessionRevoked`. Defaults to `'logout'`.
   */
  async deleteSession(sessionToken: string, reason: SessionRevocationReason = 'logout') {
    const session = await this.getSession(sessionToken);

    if (session) {
      await this.cache.delete(this.getSessionKey(sessionToken));
      await this.removeSubjectSession(session.subject, sessionToken);
      if (session.familyId) {
        await this.removeSessionFromFamily(session.familyId, sessionToken);
      }
      await this.runHook('onSessionRevoked', hook => hook(session, { reason }));
    }
  }

  /**
   * Retrieve a session from cache by its token.
   *
   * @param sessionToken - The opaque session token.
   * @returns The {@link AuthenticationSession}, or `undefined` if not found.
   */
  async getSession(sessionToken: string) {
    const response = await this.cache.get(this.getSessionKey(sessionToken));

    if (response) {
      return this.deserializeSession(response);
    }
  }

  /**
   * Retrieve all active sessions for a given subject.
   * Sessions that have expired and been evicted from cache are silently omitted.
   *
   * @param subject - The subject identifier to look up.
   * @returns An array of active {@link AuthenticationSession} objects.
   */
  async getSessionsForSubject(subject: string) {
    const tokens = await this.getSubjectSessions(subject);
    const tasks = tokens.map(x => this.getSession(x));
    const sessions = await Promise.all(tasks);
    return sessions.filter(x => x !== undefined) as AuthenticationSession[];
  }

  private async getSubjectSessions(subject: string) {
    const response = await this.cache.get(this.getSubjectKey(subject));

    if (response) {
      return JSON.parse(response) as Array<string>;
    }

    return [];
  }

  private async ensureSubjectSession(subject: string, sessionToken: string, expiration: Duration) {
    const subjectSessions = await this.getSubjectSessions(subject);
    if (!subjectSessions.includes(sessionToken)) {
      subjectSessions.push(sessionToken);
      await this.cache.set(this.getSubjectKey(subject), JSON.stringify(subjectSessions), expiration);
    }
  }

  private async removeSubjectSession(subject: string, sessionToken: string) {
    const subjectSessions = await this.getSubjectSessions(subject);
    const idx = subjectSessions.indexOf(sessionToken);
    if (idx > -1) {
      subjectSessions.splice(idx, 1);
      await this.cache.update(this.getSubjectKey(subject), JSON.stringify(subjectSessions));
    }
  }

  /**
   * Issue a signed access token plus a single-use refresh token for an existing session.
   *
   * The access token embeds the session's `factors`, `sessionToken`, and `claims`
   * (as a single nested object — *not* spread to the top level) so the server can
   * look up the full session on subsequent requests without claim names colliding
   * with reserved JWT fields. The refresh token carries `kind`, `jti`, `familyId`,
   * and `sessionToken` claims; its `jti` is registered with the session's family
   * so it participates in single-use rotation and theft detection (see
   * {@link AuthenticationSessionService.refreshSession}).
   *
   * @param sessionToken - The opaque session token to generate tokens for.
   * @returns An {@link AuthenticationToken} containing the access and refresh tokens.
   * @throws 401 when no session exists for the given token.
   */
  async issueTokenForSession(sessionToken: string): Promise<AuthenticationToken> {
    const session = await this.getSession(sessionToken);
    if (!session) {
      throw unauthorizedError('Bearer error="invalid_token"');
    }

    return this.issueTokensForLoadedSession(session);
  }

  /**
   * Rotate a session in response to a privilege change (MFA step-up, scope
   * upgrade, etc.). Mints a fresh `sessionToken`, carries the `familyId`
   * forward, and revokes the old session.
   *
   * Prefer this over {@link AuthenticationSessionService.updateSession} whenever
   * the elevation should bind to a brand-new session identifier — for example
   * after a successful MFA challenge — so a leaked pre-elevation token cannot
   * be reused at the higher privilege.
   *
   * @param sessionToken    - The opaque session token to rotate.
   * @param claimOverrides  - Claims to deep-merge into the rotated session.
   * @param expiration      - Lifetime for the rotated session; defaults to
   *   {@link AuthenticationSessionServiceOptions.expiresIn}.
   * @returns The new session and a fresh access/refresh token pair bound to it.
   * @throws 401 when the source session does not exist.
   */
  async rotateSession(sessionToken: string, claimOverrides: Record<string, unknown> = {}, expiration?: Duration) {
    const oldSession = await this.getSession(sessionToken);
    if (!oldSession) {
      throw unauthorizedError('Bearer error="invalid_token"');
    }

    const deepmerge = deepmergeCustom({
      mergeArrays: values => {
        try {
          const set = new Set(values.flat());
          return Array.from(set);
        } catch {
          return values.flat();
        }
      },
    });

    const newSessionToken = crypto.randomUUID();
    const now = DateTime.utc();
    expiration ??= this.options.expiresIn;
    const familyId = oldSession.familyId ?? crypto.randomUUID();

    const newSession: AuthenticationSession = {
      sessionToken: newSessionToken,
      subject: oldSession.subject,
      issuedAt: now,
      expiresAt: now.plus(expiration),
      lastAccessedAt: now,
      factors: oldSession.factors,
      claims: deepmerge(oldSession.claims, claimOverrides) as Record<string, unknown>,
      familyId,
    };

    await this.cache.set(this.getSessionKey(newSessionToken), this.serializeSession(newSession), expiration);
    await this.ensureSubjectSession(oldSession.subject, newSessionToken, expiration);

    await this.cache.delete(this.getSessionKey(sessionToken));
    await this.removeSubjectSession(oldSession.subject, sessionToken);
    await this.removeSessionFromFamily(familyId, sessionToken);

    const tokens = await this.issueTokensForLoadedSession(newSession);

    await this.runHook('onSessionCreated', hook => hook(newSession));
    await this.runHook('onSessionRevoked', hook => hook(oldSession, { reason: 'rotate' }));

    return { session: newSession, ...tokens };
  }

  /**
   * Exchange a refresh token for a new access/refresh token pair, rotating
   * the refresh token's `jti`. If the presented `jti` has already been
   * consumed, every session in the token's family is revoked (theft signal).
   *
   * @param refreshToken - The compact JWT string presented by the client.
   * @returns A fresh access/refresh token pair bound to the same session.
   * @throws 401 when the refresh token is invalid, replayed, or no longer
   *   resolves to a live session.
   */
  async refreshSession(refreshToken: string): Promise<AuthenticationToken> {
    const decoded = this.jwtProvider.decode(refreshToken, this.options.issuer) as
      | (RefreshTokenPayload & { exp?: number })
      | undefined;
    if (!decoded || decoded.kind !== 'refresh' || !decoded.jti || !decoded.familyId || !decoded.sessionToken) {
      await this.runHook('onValidationFailed', hook => hook('', { reason: 'refresh_token_invalid' }));
      throw unauthorizedError('Bearer error="invalid_token"');
    }

    const { jti, familyId, sessionToken } = decoded;

    const consumedKey = this.getConsumedKey(jti);
    const alreadyConsumed = await this.cache.get(consumedKey);
    if (alreadyConsumed) {
      await this.revokeFamily(familyId);
      await this.runHook('onRefreshReuseDetected', hook => hook({ familyId, jti, sessionToken }));
      throw unauthorizedError('Bearer error="invalid_token"').withInternalDetails({
        message: `refresh token jti ${jti} replayed for family ${familyId}`,
      });
    }

    const session = await this.getSession(sessionToken);
    if (!session) {
      await this.runHook('onValidationFailed', hook => hook(sessionToken, { reason: 'session_not_found' }));
      throw unauthorizedError('Bearer error="invalid_token"');
    }

    const consumedTtlSeconds = Math.max(
      decoded.exp ? decoded.exp - Math.floor(Date.now() / 1000) : 0,
      MIN_CONSUMED_TTL_SECONDS,
    );
    await this.cache.set(consumedKey, '1', Duration.fromObject({ seconds: consumedTtlSeconds }));

    const tokens = await this.issueTokensForLoadedSession(session);

    await this.runHook('onSessionRefreshed', hook => hook(session, { previousJti: jti }));

    return tokens;
  }

  private async issueTokensForLoadedSession(session: AuthenticationSession): Promise<AuthenticationToken> {
    const { claims, subject, factors, sessionToken } = session;

    const { token, decoded } = this.jwtProvider.create(
      {
        sessionToken,
        factors,
        claims,
      },
      subject,
      this.options.issuer,
      this.options.audience,
      this.options.expiresIn,
    );

    const refresh = this.mintRefreshToken(session);
    await this.addJtiToFamily(refresh.familyId, refresh.jti, sessionToken);

    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: decoded.exp ?? 0,
      refreshToken: refresh.token,
      scope: decoded.scope ? decoded.scope.join(' ') : '',
    };
  }

  private async revokeFamily(familyId: string) {
    const { blob, existed } = await this.readFamily(familyId);
    if (!existed) return;
    for (const token of blob.sessionTokens) {
      const session = await this.getSession(token);
      await this.cache.delete(this.getSessionKey(token));
      if (session) {
        await this.removeSubjectSession(session.subject, token);
        await this.runHook('onSessionRevoked', hook => hook(session, { reason: 'theft' }));
      }
    }
    await this.cache.delete(this.getFamilyKey(familyId));
  }
}
