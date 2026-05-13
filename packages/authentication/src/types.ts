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
 */
export type AuthenticationFactorMethod = 'phone' | 'password' | 'authenticator' | 'email' | 'fido' | 'oidc';

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
}

/**
 * The reason a session was revoked, surfaced to {@link AuthenticationSessionHooks.onSessionRevoked}.
 */
export type SessionRevocationReason = 'logout' | 'rotate' | 'theft' | 'expiry';

/**
 * Lifecycle callbacks consumers can register on {@link AuthenticationSessionServiceOptions}
 * to observe session events without monkey-patching the service.
 *
 * Hooks fire **after** the cache write/delete so they observe committed state.
 * They run sequentially and are awaited; errors are logged but not propagated
 * (a failing hook must not break authentication).
 */
export interface AuthenticationSessionHooks {
  /** Fired after a new session has been created and persisted. */
  onSessionCreated?: (session: AuthenticationSession) => Promise<void> | void;
  /** Fired after a refresh-token rotation has succeeded. `previousJti` is the now-consumed token id. */
  onSessionRefreshed?: (session: AuthenticationSession, meta: { previousJti: string }) => Promise<void> | void;
  /** Fired after a session has been deleted from cache. `reason` discriminates logout / rotate / theft / expiry. */
  onSessionRevoked?: (session: AuthenticationSession, meta: { reason: SessionRevocationReason }) => Promise<void> | void;
  /** Fired when JWT validation or session lookup fails. `sessionToken` is the value carried in the token (may be empty). */
  onValidationFailed?: (sessionToken: string, meta: { reason: string }) => Promise<void> | void;
  /**
   * Fired when a previously-consumed refresh token is presented (theft signal).
   * Receives the family id, the replayed `jti`, and (when available) the bound session token.
   * Every session in the family is revoked before this hook fires.
   */
  onRefreshReuseDetected?: (meta: { familyId: string; jti: string; sessionToken?: string }) => Promise<void> | void;
}

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
