import { DateTime } from 'luxon';

/**
 * The category of authentication factor based on classic MFA taxonomy.
 *
 * * `knowledge` Something you know (e.g. password, PIN)
 * * `possession` Something you have (e.g. TOTP app, hardware key)
 * * `biometric` Something you are (e.g. fingerprint, face ID)
 */
export type AuthenticationFactorKind = 'knowledge' | 'possession' | 'biometric';

/**
 * The verification method used to satisfy an authentication factor within a
 * session. Corresponds to the built-in factor services shipped by this package.
 *
 * `'apikey'` is the odd one out: it is not a factor a user enrols but the
 * machine credential `ApiKeyService` authenticates with, recorded here so a
 * key-authenticated session says honestly how it was established and so
 * `excludeMethods: ['apikey']` on a step-up policy means something.
 */
export type AuthenticationFactorMethod = 'phone' | 'password' | 'authenticator' | 'email' | 'fido' | 'oidc' | 'apikey';

/**
 * A single authentication factor recorded within a server-side session.
 * Tracks when the factor was issued and last verified so that per-factor
 * expiry policies can be enforced at the application layer.
 */
export interface AuthenticationSessionFactor {
  /** When this factor entry was first added to the session. */
  issuedAt: DateTime;
  /** When the factor was most recently re-verified. */
  authenticatedAt: DateTime;
  /** The verification method used. */
  method: AuthenticationFactorMethod;
  /** Stable identifier for the specific factor record (e.g. a DB row id). */
  methodId: string;
  /** MFA category this factor belongs to. */
  kind: AuthenticationFactorKind;
}

/**
 * Where a session was established from.
 *
 * Describes the request that *began* the session, not wherever it was last used.
 * A revoke or a refresh happens on a different request, so the live context at
 * that point describes a different caller — which is exactly why this is stored
 * on the session rather than read from the request each time.
 *
 * Every field is optional, and the whole block is absent when none is known. It
 * is filled by the application: this package sits at L2 alongside the HTTP
 * adapters and cannot reach a request. Both adapters already carry what it needs
 * on their context as `ipAddress` and `userAgent`.
 *
 * ```ts
 * await sessionService.createSession(user.id, claims, factor, undefined, {
 *   ipAddress: ctx.ipAddress,
 *   userAgent: ctx.userAgent,
 * });
 * ```
 */
export interface SessionDevice {
  /**
   * The caller's IP address, as the application resolved it.
   *
   * **Not validated.** Whatever is passed is stored verbatim, because a correct
   * IPv4/IPv6 validator is more surface than this earns and the adapters already
   * defer to the framework's own `trustProxy` handling. An application writing
   * this to a typed column — Postgres `inet` rejects malformed input — owns that
   * check.
   */
  ipAddress?: string;
  /**
   * The `User-Agent` header, truncated to {@link MAX_USER_AGENT_LENGTH}.
   *
   * Truncation is not cosmetic: the header is attacker-controlled and otherwise
   * unbounded.
   */
  userAgent?: string;
  /**
   * A human-readable name for the device, e.g. `'Chrome on macOS'`.
   *
   * The application's to compose. This package does not parse user agents —
   * doing it well means a dependency on a signature database that goes stale,
   * and doing it badly is worse than not doing it.
   */
  label?: string;
}

/**
 * A server-side authentication session stored in cache.
 * The session is the authoritative record; a JWT issued from it is just a
 * short-lived signed reference — revoke the session to invalidate all tokens.
 */
export interface AuthenticationSession {
  /** Opaque random token used as the cache key and embedded in JWTs. */
  sessionToken: string;
  /** Subject identifier (typically a user id). */
  subject: string;
  /** When the session was originally issued. */
  issuedAt: DateTime;
  /** When the session expires. */
  expiresAt: DateTime;
  /** When the session was last accessed. */
  lastAccessedAt: DateTime;
  /** Factors that have been satisfied in this session. */
  factors: AuthenticationSessionFactor[];
  /** Arbitrary claims to embed in tokens issued from this session. */
  claims: Record<string, unknown>;
  /**
   * Identifier shared across every refresh-token rotation that descends from
   * a single login. Used to revoke every session in the chain when a consumed
   * refresh token is replayed (theft detection). Carried forward across
   * {@link AuthenticationSession} rotations triggered by privilege changes.
   */
  familyId?: string;
  /**
   * Where the session was established from, when the application supplied it.
   *
   * Absent on sessions created without it, including every session cached before
   * this field existed and every session an API key establishes — a machine
   * credential has no device, and inventing one would put a misleading row in a
   * user's session list.
   */
  device?: SessionDevice;
}

/**
 * The reason a session was revoked, carried on the `session.revoked` audit event.
 */
export type SessionRevocationReason = 'logout' | 'rotate' | 'theft' | 'expiry' | 'recovery';

/**
 * Sentinel value representing an unauthenticated or failed authentication state.
 * All `DateTime` fields are marked invalid; use this as a safe default before
 * authentication has been resolved, or when authentication fails.
 */
export const invalidAuthenticationSession: AuthenticationSession = {
  subject: '',
  sessionToken: '',
  issuedAt: DateTime.invalid('invalid'),
  lastAccessedAt: DateTime.invalid('invalid'),
  expiresAt: DateTime.invalid('invalid'),
  factors: [],
  claims: {},
  familyId: undefined,
} as const;

/**
 * OAuth 2.0-style token response returned after generating a JWT from a session.
 */
export type AuthenticationToken = {
  /** The access token string as issued by the authorization server. */
  accessToken: string;
  /** The type of token this is, typically just the string `Bearer`. */
  tokenType: string;
  /** Unix timestamp (seconds) at which the access token expires. */
  expiresIn: number;
  /** A refresh token which applications can use to obtain another access token. */
  refreshToken?: string;
  /** Space-separated list of scopes granted to this token. */
  scope: string;
};
