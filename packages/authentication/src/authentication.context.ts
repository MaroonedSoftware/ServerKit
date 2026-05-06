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
export type AuthenticationFactorMethod = 'phone' | 'password' | 'authenticator' | 'email' | 'fido';

/**
 * Describes a single authentication factor that was satisfied during a session.
 */
export interface AuthenticationFactor {
  /** The specific method used (e.g. `"password"`, `"totp"`, `"webauthn"`). */
  method: string;
  /** When this factor was last successfully authenticated. */
  lastAuthenticated: DateTime;
  /** The MFA category this factor belongs to. */
  kind: AuthenticationFactorKind;
}

/**
 * The resolved authentication context attached to a request after a successful
 * authentication check. Carries session metadata, satisfied factors, and
 * arbitrary claims extracted from the credential (e.g. JWT payload).
 */
export interface AuthenticationContext {
  /** Unique identifier for the subject that was authenticated. */
  subject: string;
  /** When the session was originally issued. */
  issuedAt: DateTime;
  /** When the session was last accessed. */
  lastAccessedAt: DateTime;
  /** When the session expires. */
  expiresAt: DateTime;
  /** Authentication factors satisfied in this session. */
  factors: AuthenticationFactor[];
  /** Arbitrary key/value claims extracted from the credential. */
  claims: Record<string, unknown>;
  /** Roles assigned to the authenticated subject. */
  roles: string[];
}

/**
 * Sentinel value representing an unauthenticated or failed authentication state.
 * All `DateTime` fields are marked invalid; use this as a safe default before
 * authentication has been resolved, or when authentication fails.
 */
export const invalidAuthenticationContext: AuthenticationContext = {
  subject: '',
  issuedAt: DateTime.invalid('invalid'),
  lastAccessedAt: DateTime.invalid('invalid'),
  expiresAt: DateTime.invalid('invalid'),
  factors: [],
  claims: {},
  roles: [],
} as const;

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
}

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
