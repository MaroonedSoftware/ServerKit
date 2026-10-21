import { Injectable } from 'injectkit';
import { unauthorizedError } from '@maroonedsoftware/errors';
import { DateTime, Duration } from 'luxon';
import { deepmergeCustom } from 'deepmerge-ts';
import { normaliseSessionDevice } from './helpers.js';
import { AuditRecorder } from './audit/audit.recorder.js';
import type { AuditSessionData, SessionValidationFailureReason } from './audit/session.audit.event.js';
import { AuthenticationSession, AuthenticationSessionFactor, AuthenticationToken, SessionDevice, SessionRevocationReason } from './types.js';
import { CacheProvider } from '@maroonedsoftware/cache';
import { JwtProvider } from './providers/jwt.provider.js';

/**
 * Minimum TTL applied to a consumed-jti sentinel to absorb small clock skew
 * between the token issuer and any verifier. The effective TTL is
 * `max(remaining-token-lifetime, MIN_CONSUMED_TTL_SECONDS)`.
 */
const MIN_CONSUMED_TTL_SECONDS = 60;

/**
 * Upper bound on how many rotations a theft revocation follows down a session's
 * successor chain. A chain is one link per `rotateSession`, so this is far past
 * any real one; it only stops a corrupt cache from looping forever.
 */
const MAX_SUCCESSOR_CHAIN = 1000;

/**
 * Shape of the family blob earlier versions kept under
 * `auth_refresh_family_{familyId}`. Nothing writes it any more; theft revocation
 * still reads it so sessions tracked only there are revoked until the last of
 * those entries expires.
 */
interface LegacyRefreshFamilyBlob {
  sessionTokens?: unknown;
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
 * Whether a token's `aud` names an audience the caller accepts.
 *
 * Either side may be a list; they match when they share at least one value, by
 * exact string equality. That is jsonwebtoken's own rule, so a token accepted
 * here is exactly one `jwt.verify` would have accepted with the same audience.
 * A token with no `aud` matches nothing.
 */
const audienceMatches = (actual: string | string[] | undefined, expected: string | string[]): boolean => {
  if (actual === undefined) return false;
  const actualList = Array.isArray(actual) ? actual : [actual];
  const expectedList = Array.isArray(expected) ? expected : [expected];
  return actualList.some(value => expectedList.includes(value));
};

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
    /**
     * Records session lifecycle events. Defaulted, so an application that has not
     * bound an `AuditSink` gets a working no-op rather than a wiring error.
     */
    private readonly audit: AuditRecorder = new AuditRecorder(),
  ) {}

  /**
   * Project a session onto the shape audit events carry.
   *
   * `claims` goes through whole: an application that stamps request detail onto
   * a session at login needs it back on a later revoke, which happens on a
   * different request.
   */
  private auditSessionData(session: AuthenticationSession): AuditSessionData {
    return {
      sessionToken: session.sessionToken,
      ...(session.familyId === undefined ? {} : { familyId: session.familyId }),
      factors: session.factors.map(({ method, methodId, kind }) => ({ method, methodId, kind })),
      claims: session.claims,
      expiresAt: session.expiresAt.toISO() ?? '',
      ...(session.device === undefined ? {} : { device: session.device }),
      ...(session.audience === undefined ? {} : { audience: session.audience }),
    };
  }

  /**
   * Check a verified token's `aud` against what the caller accepts, recording and
   * refusing a mismatch. Runs before any cache read.
   *
   * With neither an `expectedAudience` nor a configured service audience there is
   * nothing to compare against and the check is skipped, which is how a service
   * built without an audience has always behaved.
   */
  private async assertAudience(
    payload: { aud?: string | string[]; sub?: string; sessionToken?: string },
    expectedAudience: string | string[] | undefined,
  ) {
    const expected = expectedAudience ?? this.options.audience;
    if (expected === undefined || (Array.isArray(expected) && expected.length === 0)) return;
    if (audienceMatches(payload.aud, expected)) return;

    await this.auditValidationFailed('audience_mismatch', payload.sessionToken, payload.sub);
    throw unauthorizedError('Bearer error="invalid_token"').withInternalDetails({
      message: `token audience ${JSON.stringify(payload.aud)} is not accepted here`,
    });
  }

  /** Record a failed validation, attributing an actor whenever one is known. */
  private async auditValidationFailed(reason: SessionValidationFailureReason, sessionToken?: string, actorId?: string) {
    await this.audit.record({
      type: 'session.validation_failed',
      category: 'login',
      outcome: 'failure',
      ...(actorId === undefined ? {} : { actorId }),
      data: { ...(sessionToken ? { sessionToken } : {}), reason },
    });
  }

  private getSessionKey(id: string) {
    return `auth_session_${id}`;
  }

  /** The per-subject session index: a cache set with one member per session token. */
  private getSubjectKey(id: string) {
    return `auth_subject_sessions_${id}`;
  }

  /**
   * The index as it was before it became a set: a JSON array of tokens, rewritten on every
   * change. Only read now, so sessions it lists stay visible to `revokeAllForSubject` until it
   * expires. Never written, because a read-modify-write of it is what lost sessions.
   */
  private getLegacySubjectKey(id: string) {
    return `auth_session_subject_${id}`;
  }

  private getFamilyKey(familyId: string) {
    return `auth_refresh_family_${familyId}`;
  }

  private getConsumedKey(jti: string) {
    return `auth_refresh_consumed_${jti}`;
  }

  /**
   * Where `rotateSession` records which session replaced `sessionToken`. Written
   * once per rotation and never rewritten, so concurrent writers cannot lose an
   * update the way a shared family list could.
   */
  private getSuccessorKey(sessionToken: string) {
    return `auth_session_successor_${sessionToken}`;
  }

  /** Set when a family is revoked for theft, so a rotation still in flight cannot outlive it. */
  private getFamilyRevokedKey(familyId: string) {
    return `auth_refresh_family_revoked_${familyId}`;
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
      device: session.device,
      audience: session.audience,
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
      // Absent on anything cached before this field existed, which is why it is
      // optional rather than defaulted: an empty block would be a claim about
      // the session that nobody made.
      device: session.device,
      // Absent on anything cached before this field existed. Those sessions were
      // all minted with the service default, which is what absent means.
      audience: session.audience,
    };
  }

  /**
   * Undo a rotation that failed before it took effect: free the old session's
   * successor slot, drop the half-written replacement, and put the old session
   * back. Best effort, since it runs while another error is already propagating;
   * a step that fails here is left to expire.
   *
   * The old session goes back before the revocation marker is read, mirroring
   * `rotateSession`: a theft revocation writes the marker and then deletes the
   * chain, so either it deletes the restored session or this check sees the
   * marker and deletes it again.
   */
  private async releaseRotation(oldSession: AuthenticationSession, oldRaw: string, newSessionToken: string) {
    const { sessionToken, subject } = oldSession;
    const steps = [
      () => this.cache.delete(this.getSuccessorKey(sessionToken)),
      () => this.cache.delete(this.getSessionKey(newSessionToken)),
      () => this.removeSubjectSession(subject, newSessionToken),
      () => this.restoreOldSession(oldSession, oldRaw),
    ];
    for (const step of steps) {
      try {
        await step();
      } catch {
        // Keep going: the caller rethrows the original failure.
      }
    }
  }

  /**
   * Put back a session `rotateSession` consumed, with its remaining lifetime,
   * unless it has expired or its family has been revoked. Writes before reading
   * the revocation marker (see {@link releaseRotation}).
   */
  private async restoreOldSession(oldSession: AuthenticationSession, oldRaw: string) {
    const remaining = oldSession.expiresAt.diff(DateTime.utc());
    if (remaining.toMillis() <= 0) return;
    await this.cache.set(this.getSessionKey(oldSession.sessionToken), oldRaw, remaining);
    if (oldSession.familyId && (await this.cache.get(this.getFamilyRevokedKey(oldSession.familyId)))) {
      await this.cache.delete(this.getSessionKey(oldSession.sessionToken));
    }
  }

  /** Session tokens listed in a family blob written by an earlier version, if one is still cached. */
  private async readLegacyFamily(familyId: string): Promise<string[]> {
    const raw = await this.cache.get(this.getFamilyKey(familyId));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as LegacyRefreshFamilyBlob;
      return Array.isArray(parsed.sessionTokens) ? parsed.sessionTokens.filter((token): token is string => typeof token === 'string') : [];
    } catch {
      // Corrupt entry: nothing to revoke from it.
      return [];
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
      session.audience ?? this.options.audience,
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
   * @param device     - Where the request came from, for a session list and for audit events.
   *   Normalised on the way in; omit it and the session simply carries none.
   * @param audience   - The `aud` every token from this session carries, when it is not the
   *   service default. A token minted for it is refused by any validation that does not
   *   pass it as `expectedAudience`. Fixed for the life of the session.
   * @returns The newly created {@link AuthenticationSession}.
   */
  async createSession(
    subject: string,
    claims: Record<string, unknown>,
    factors: AuthenticationSessionFactor | AuthenticationSessionFactor[],
    expiration?: Duration,
    device?: SessionDevice,
    audience?: string | string[],
  ) {
    const sessionToken = crypto.randomUUID();
    const familyId = crypto.randomUUID();
    const now = DateTime.utc();
    expiration ??= this.options.expiresIn;
    const normalisedDevice = normaliseSessionDevice(device);

    const session: AuthenticationSession = {
      sessionToken: sessionToken,
      subject,
      issuedAt: now,
      expiresAt: now.plus(expiration),
      lastAccessedAt: now,
      factors: Array.isArray(factors) ? factors : [factors],
      claims,
      familyId,
      ...(normalisedDevice === undefined ? {} : { device: normalisedDevice }),
      ...(audience === undefined ? {} : { audience }),
    };

    await this.cache.set(this.getSessionKey(sessionToken), this.serializeSession(session), expiration);

    await this.ensureSubjectSession(subject, sessionToken, expiration);

    await this.audit.record({
      type: 'session.created',
      category: 'session',
      outcome: 'success',
      actorId: subject,
      data: this.auditSessionData(session),
    });

    return session;
  }

  /**
   * Update an existing session's claims and/or factors and reset its expiry.
   *
   * `expiresAt` is rewritten to `now + expiration` (absolute, not additive) so that
   * repeated calls cannot stretch a session beyond the configured lifetime.
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
   * @param expiration   - Lifetime applied from "now" as the session's new `expiresAt`; defaults
   *   to {@link AuthenticationSessionServiceOptions.expiresIn}.
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

    session.expiresAt = DateTime.utc().plus(expiration);
    session.lastAccessedAt = DateTime.utc();

    await this.cache.update(this.getSessionKey(sessionToken), this.serializeSession(session), expiration);
    await this.ensureSubjectSession(session.subject, sessionToken, expiration);

    // `privilege`, not `session`: claims and factors are what a route's policy
    // reads, so changing them changes what the session may do.
    await this.audit.record({
      type: 'session.updated',
      category: 'privilege',
      outcome: 'success',
      actorId: session.subject,
      data: this.auditSessionData(session),
    });

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
    device?: SessionDevice,
  ) {
    if (sessionToken) {
      const session = await this.getSession(sessionToken);

      if (session) {
        // Only the create arm takes the device: updating a live session must not
        // rewrite where it began, and this arm is reached when the caller already
        // had one.
        return await this.updateSession(sessionToken, subject, expiration, claims, factor);
      }
    }

    return await this.createSession(subject, claims, factor, expiration, device);
  }

  /**
   * Validate a JWT and retrieve the session it references.
   *
   * Decodes and verifies the JWT, then looks up the embedded `sessionToken` in
   * cache and cross-checks that the session subject matches the JWT subject.
   *
   * The token's `aud` must match `expectedAudience` when given, and the service's
   * configured audience otherwise. That is what keeps a token issued for one
   * resource (a session created with its own `audience`) off every route that
   * does not ask for it: an ordinary route passes nothing and refuses it. The
   * audience is checked before the session is read, so a mismatch costs no cache
   * round trip. A refresh token is never accepted here.
   *
   * @param jwt                 - The signed JWT string to validate.
   * @param ignoreJwtExpiration - When `true`, an expired JWT is still decoded
   *   (useful for refresh flows where the session itself controls expiry).
   * @param expectedAudience    - The audience this route accepts. Defaults to
   *   {@link AuthenticationSessionServiceOptions.audience}.
   * @returns An object containing the {@link AuthenticationSession} and the decoded JWT payload.
   * @throws 401 when the JWT is invalid, is a refresh token, was issued for another
   *   audience, the session is not found, or the subjects don't match.
   */
  async lookupSessionFromJwt(jwt: string, ignoreJwtExpiration?: boolean, expectedAudience?: string | string[]) {
    // Decoded without an audience so a wrong one is told apart from a bad
    // signature; assertAudience enforces it immediately below.
    const jwtPayload = this.jwtProvider.decode(jwt, this.options.issuer, ignoreJwtExpiration, false);
    if (!jwtPayload) {
      // The one failure with no actor to attribute: the token never decoded.
      await this.auditValidationFailed('jwt_decode_failed');
      throw unauthorizedError('Bearer error="invalid_token"');
    }

    if (jwtPayload.kind === 'refresh') {
      await this.auditValidationFailed('refresh_token_presented', jwtPayload.sessionToken, jwtPayload.sub);
      throw unauthorizedError('Bearer error="invalid_token"').withInternalDetails({
        message: 'a refresh token was presented as an access token',
      });
    }

    await this.assertAudience(jwtPayload, expectedAudience);

    const session = await this.getSession(jwtPayload.sessionToken ?? '');

    if (!session) {
      await this.auditValidationFailed('session_not_found', jwtPayload.sessionToken, jwtPayload.sub);
      throw unauthorizedError('Bearer error="invalid_token"').withInternalDetails({
        message: `unable to find session ${jwtPayload.sessionToken}`,
      });
    }

    if (session.subject !== jwtPayload.sub) {
      await this.auditValidationFailed('subject_mismatch', jwtPayload.sessionToken, session.subject);
      throw unauthorizedError('Bearer error="invalid_token"').withInternalDetails({
        message: `session ${jwtPayload.sessionToken} not valid for ${jwtPayload.sub}`,
      });
    }

    return { session, jwtPayload };
  }

  /**
   * Delete a session from cache, effectively revoking all tokens issued from it.
   * Does nothing if the session does not exist.
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
      await this.audit.record({
        type: 'session.revoked',
        category: 'session',
        outcome: 'success',
        actorId: session.subject,
        data: { ...this.auditSessionData(session), reason },
      });
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
    // Safe only because writers store a session before indexing it; see ensureSubjectSession.
    await Promise.all(tokens.filter((_, i) => sessions[i] === undefined).map(x => this.removeSubjectSession(subject, x)));
    return sessions.filter(x => x !== undefined) as AuthenticationSession[];
  }

  /**
   * Revoke every active session for a subject.
   *
   * Use after any event that invalidates prior authentication — a password reset,
   * a full account recovery, an admin-forced logout — so tokens minted before the
   * event stop working. Each revocation fires `onSessionRevoked` with `reason`.
   *
   * @param subject - The subject identifier whose sessions should be revoked.
   * @param reason  - The reason surfaced to `onSessionRevoked`. Defaults to `'logout'`.
   * @returns The number of sessions that were revoked.
   */
  async revokeAllForSubject(subject: string, reason: SessionRevocationReason = 'logout'): Promise<number> {
    const tokens = await this.getSubjectSessions(subject);
    let revoked = 0;
    for (const token of tokens) {
      const session = await this.getSession(token);
      if (!session) {
        await this.removeSubjectSession(subject, token);
        continue;
      }
      await this.deleteSession(token, reason);
      revoked += 1;
    }

    // Alongside the per-session events `deleteSession` already emitted. The
    // count is the part no hook ever sees.
    await this.audit.record({
      type: 'session.revoked_all',
      category: 'session',
      outcome: 'success',
      actorId: subject,
      data: { reason, count: revoked },
    });

    return revoked;
  }

  /**
   * Every token indexed for a subject: the set's members plus whatever the legacy list still
   * holds. Either may name a session that has since gone, so callers check each one and
   * prune the ones that are missing. That pruning is safe only because every writer stores a
   * session's key before indexing it, and deletes the key before un-indexing it.
   */
  private async getSubjectSessions(subject: string) {
    const legacy = await this.cache.get(this.getLegacySubjectKey(subject));
    const members = await this.cache.setMembers(this.getSubjectKey(subject));
    const legacyTokens = legacy ? (JSON.parse(legacy) as Array<string>) : [];
    return [...new Set([...legacyTokens, ...members])];
  }

  /**
   * Index a session under its subject. A single atomic add, so concurrent writers for one
   * subject cannot drop each other's sessions. The index's expiry only ever grows, so it
   * outlives the longest-lived session in it.
   *
   * Call it only after the session key is written. Readers prune index members whose session
   * is missing, so indexing first would let a concurrent read drop the new session from the
   * index, and with it from `revokeAllForSubject`.
   */
  private async ensureSubjectSession(subject: string, sessionToken: string, expiration: Duration) {
    await this.cache.setAdd(this.getSubjectKey(subject), sessionToken, { ttl: expiration });
  }

  /** Drop a session from its subject's index. A single atomic remove. */
  private async removeSubjectSession(subject: string, sessionToken: string) {
    await this.cache.setRemove(this.getSubjectKey(subject), sessionToken);
  }

  /**
   * Issue a signed access token plus a single-use refresh token for an existing session.
   *
   * The access token embeds the session's `factors`, `sessionToken`, and `claims`
   * (as a single nested object — *not* spread to the top level) so the server can
   * look up the full session on subsequent requests without claim names colliding
   * with reserved JWT fields. The refresh token carries `kind`, `jti`, `familyId`,
   * and `sessionToken` claims; its `jti` is single-use, and presenting it twice
   * revokes the session and every session rotated from it (see
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
   * @throws 401 when the source session does not exist, another rotation of it
   *   already succeeded (concurrent rotations of one session succeed once), or
   *   its family was revoked for theft while the rotation ran.
   */
  async rotateSession(sessionToken: string, claimOverrides: Record<string, unknown> = {}, expiration?: Duration, device?: SessionDevice) {
    // Consume the old session up front, atomically, so two concurrent rotations
    // of one session cannot both mint an elevated replacement.
    const raw = await this.cache.take(this.getSessionKey(sessionToken));
    if (!raw) {
      throw unauthorizedError('Bearer error="invalid_token"');
    }
    const oldSession = this.deserializeSession(raw);

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
    const rotatedDevice = normaliseSessionDevice(device) ?? oldSession.device;

    const newSession: AuthenticationSession = {
      sessionToken: newSessionToken,
      subject: oldSession.subject,
      issuedAt: now,
      expiresAt: now.plus(expiration),
      lastAccessedAt: now,
      factors: oldSession.factors,
      claims: deepmerge(oldSession.claims, claimOverrides) as Record<string, unknown>,
      familyId,
      // Carried forward unless the caller re-stamps it. A step-up happens on a
      // live request, but the session's origin is where it *began* — the same
      // reason the claims carry forward rather than being rebuilt.
      ...(rotatedDevice === undefined ? {} : { device: rotatedDevice }),
      // A rotation must not widen where the session's tokens are accepted.
      ...(oldSession.audience === undefined ? {} : { audience: oldSession.audience }),
    };

    // Claim the old session's successor slot before writing anything. Theft
    // revocation follows it from a replayed token for the old session to this
    // one, so it must outlive every refresh token issued for the old session.
    // Set-if-absent: of two concurrent rotations only one can link itself, and
    // the other is refused rather than left untracked.
    const linked = await this.cache.add(this.getSuccessorKey(sessionToken), newSessionToken, { ttl: this.options.refreshExpiresIn });
    if (!linked) {
      // Unreachable for a concurrent rotation (the `take` above refused it), so
      // this is a stale link left by a release that could not delete it. Leave
      // the link alone and put the old session back, so a failed rotation never
      // signs the user out.
      try {
        await this.restoreOldSession(oldSession, raw);
      } catch {
        // Best effort, as in `releaseRotation`.
      }
      throw unauthorizedError('Bearer error="invalid_token"').withInternalDetails({ message: `session ${sessionToken} was already rotated` });
    }

    // The old session was consumed above. A failure before the new one is fully
    // in place releases the successor slot and puts the old session back, so a
    // transient error does not sign the user out or block the next rotation.
    let revokedDuringRotation = false;
    try {
      await this.cache.set(this.getSessionKey(newSessionToken), this.serializeSession(newSession), expiration);
      await this.ensureSubjectSession(oldSession.subject, newSessionToken, expiration);

      // A theft revocation of this family may be running concurrently. It writes
      // its marker and then walks the chain; this rotation linked and wrote its
      // session and only then reads the marker. So either the walk reaches the new
      // session and deletes it, or this check sees the marker. Order matters: both
      // writes above must come before this read.
      if (await this.cache.get(this.getFamilyRevokedKey(familyId))) {
        revokedDuringRotation = true;
        await this.cache.delete(this.getSessionKey(newSessionToken));
        await this.removeSubjectSession(oldSession.subject, newSessionToken);
        throw unauthorizedError('Bearer error="invalid_token"').withInternalDetails({ message: `family ${familyId} was revoked during rotation` });
      }
    } catch (error) {
      // A revoked family keeps the link and does not get the old session back.
      if (!revokedDuringRotation) {
        await this.releaseRotation(oldSession, raw, newSessionToken);
      }
      throw error;
    }
    await this.removeSubjectSession(oldSession.subject, sessionToken);

    const tokens = await this.issueTokensForLoadedSession(newSession);

    // One event, not the created/revoked pair the hooks fire: a consumer should
    // not have to correlate two records to see that one session replaced another.
    await this.audit.record({
      type: 'session.rotated',
      category: 'privilege',
      outcome: 'success',
      actorId: oldSession.subject,
      data: { ...this.auditSessionData(newSession), previousSessionToken: sessionToken },
    });

    return { session: newSession, ...tokens };
  }

  /**
   * Exchange a refresh token for a new access/refresh token pair, rotating
   * the refresh token's `jti`. If the presented `jti` has already been
   * consumed, the token's session and every session rotated from it are revoked
   * (theft signal).
   *
   * The token's `aud` must match `expectedAudience` when given, and the service's
   * configured audience otherwise, checked before the `jti` is claimed so a token
   * presented at the wrong endpoint is refused without being spent.
   *
   * `guard` binds a refresh to more than possession of the token: the OAuth token
   * endpoint uses it to require that the presenting client is the one the session
   * was granted to. It runs after the `jti` is claimed and the session loaded, and
   * before new tokens are minted. Whatever it throws propagates unchanged, and the
   * `jti` stays consumed, so a stolen token presented by the wrong client burns
   * it and the legitimate client's next presentation trips family revocation.
   *
   * @param refreshToken     - The compact JWT string presented by the client.
   * @param expectedAudience - The audience this endpoint accepts. Defaults to
   *   {@link AuthenticationSessionServiceOptions.audience}.
   * @param guard            - Optional check against the loaded session; throw to refuse.
   * @returns A fresh access/refresh token pair bound to the same session.
   * @throws 401 when the refresh token is invalid, issued for another audience,
   *   replayed, or no longer resolves to a live session.
   */
  async refreshSession(
    refreshToken: string,
    expectedAudience?: string | string[],
    guard?: (session: AuthenticationSession) => void | Promise<void>,
  ): Promise<AuthenticationToken> {
    const decoded = this.jwtProvider.decode(refreshToken, this.options.issuer, undefined, false) as
      (RefreshTokenPayload & { exp?: number; aud?: string | string[]; sub?: string }) | undefined;
    if (!decoded || decoded.kind !== 'refresh' || !decoded.jti || !decoded.familyId || !decoded.sessionToken) {
      await this.auditValidationFailed('refresh_token_invalid');
      throw unauthorizedError('Bearer error="invalid_token"');
    }

    await this.assertAudience(decoded, expectedAudience);

    const { jti, familyId, sessionToken } = decoded;

    // Atomically claim this jti so two concurrent presentations of the same
    // refresh token cannot both pass the reuse gate. `add` sets the key only if
    // it does not already exist; a `false` result means the jti was already
    // consumed (a replay / theft signal).
    const consumedKey = this.getConsumedKey(jti);
    const consumedTtlSeconds = Math.max(decoded.exp ? decoded.exp - Math.floor(DateTime.now().toSeconds()) : 0, MIN_CONSUMED_TTL_SECONDS);
    const claimed = await this.cache.add(consumedKey, '1', { ttl: Duration.fromObject({ seconds: consumedTtlSeconds }) });
    if (!claimed) {
      const revokedInFamily = await this.revokeFamily(familyId, sessionToken);
      await this.audit.record({
        type: 'session.family_revoked',
        category: 'session',
        outcome: 'success',
        data: { familyId, count: revokedInFamily },
      });
      await this.audit.record({
        type: 'session.refresh_reuse_detected',
        category: 'login',
        outcome: 'failure',
        data: { familyId, jti, ...(sessionToken ? { sessionToken } : {}) },
      });
      throw unauthorizedError('Bearer error="invalid_token"').withInternalDetails({
        message: `refresh token jti ${jti} replayed for family ${familyId}`,
      });
    }

    const session = await this.getSession(sessionToken);
    if (!session) {
      await this.auditValidationFailed('session_not_found', sessionToken);
      throw unauthorizedError('Bearer error="invalid_token"');
    }

    if (guard) {
      await guard(session);
    }

    const tokens = await this.issueTokensForLoadedSession(session);

    await this.audit.record({
      type: 'session.refreshed',
      category: 'session',
      outcome: 'success',
      actorId: session.subject,
      data: { ...this.auditSessionData(session), previousJti: jti },
    });

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
      session.audience ?? this.options.audience,
      this.options.expiresIn,
    );

    const refresh = this.mintRefreshToken(session);

    return {
      accessToken: token,
      tokenType: 'Bearer',
      expiresIn: decoded.exp ? Math.max(decoded.exp - Math.floor(DateTime.now().toSeconds()), 0) : 0,
      refreshToken: refresh.token,
      scope: decoded.scope ? decoded.scope.join(' ') : '',
    };
  }

  /**
   * Tear down every session in a refresh-token family that a replayed token can
   * reach: the session it was issued for, then each session rotated from it in
   * turn, plus the chain from each session a legacy family record still lists.
   * Sessions before it in the chain were already deleted by the rotations that
   * replaced them.
   *
   * @returns How many sessions were revoked, so the caller can record the
   *   aggregate alongside the per-session events.
   */
  private async revokeFamily(familyId: string, sessionToken: string): Promise<number> {
    // Before the walk, so a concurrent rotation either sees it or is reached by
    // the walk (see `rotateSession`).
    await this.cache.set(this.getFamilyRevokedKey(familyId), '1', this.options.refreshExpiresIn);

    // Walk from the replayed token's session, and from every session a legacy
    // family record lists: a session rotated after the upgrade hangs off the
    // chain head that record held, not off the replayed token's session.
    const tokens: string[] = [];
    const seen = new Set<string>();
    for (const root of [sessionToken, ...(await this.readLegacyFamily(familyId))]) {
      let next: string | null = root;
      while (next !== null && !seen.has(next) && seen.size < MAX_SUCCESSOR_CHAIN) {
        seen.add(next);
        tokens.push(next);
        next = await this.cache.get(this.getSuccessorKey(next));
      }
    }

    let revoked = 0;
    for (const token of tokens) {
      const session = await this.getSession(token);
      await this.cache.delete(this.getSessionKey(token));
      if (session) {
        await this.removeSubjectSession(session.subject, token);
        await this.audit.record({
          type: 'session.revoked',
          category: 'session',
          outcome: 'success',
          actorId: session.subject,
          data: { ...this.auditSessionData(session), reason: 'theft' },
        });
        revoked += 1;
      }
    }
    await this.cache.delete(this.getFamilyKey(familyId));

    return revoked;
  }
}
