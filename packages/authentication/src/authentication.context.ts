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
  /** Unique identifier for the actor that was authenticated. */
  actorId: string;
  /** The type of actor that was authenticated. */
  actorType: string;
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
  /** Roles assigned to the authenticated user. */
  roles: string[];
}

/**
 * Sentinel value representing an unauthenticated or failed authentication state.
 * All `DateTime` fields are marked invalid; use this as a safe default before
 * authentication has been resolved, or when authentication fails.
 */
export const invalidAuthenticationContext: AuthenticationContext = {
  actorId: '',
  actorType: '',
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
  /** Unix timestamp (seconds) when this factor entry was first created. */
  issuedAt: number;
  /** Unix timestamp (seconds) of the most recent successful verification. */
  authenticatedAt: number;
  /** The verification method used (e.g. `"password"`, `"authenticator"`). */
  method: 'phone' | 'password' | 'authenticator' | 'email' | 'fido' | 'exchange';
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
  token: string;
  /** Subject identifier (typically a user id). */
  subject: string;
  /** Unix timestamp (seconds) when the session was created. */
  issuedAt: number;
  /** Unix timestamp (seconds) when the session expires. */
  expiresAt: number;
  /** Unix timestamp (seconds) of the most recent access. */
  lastAccessedAt: number;
  /** Factors that have been satisfied in this session. */
  factors: AuthenticationSessionFactor[];
  /** Arbitrary claims to embed in tokens issued from this session. */
  claims: Record<string, unknown>;
}

/**
 * OAuth 2.0-style token response returned after generating a JWT from a session.
 */
export type AuthenticationToken = {
  /** Signed JWT that clients present as a `Bearer` credential. */
  accessToken: string;
  /** Always `"Bearer"`. */
  tokenType: string;
  /** Unix timestamp (seconds) when the access token expires. */
  expiresIn: number;
  /** Optional refresh token for obtaining a new access token. */
  refreshToken?: string;
  /** Space-separated list of scopes granted to this token. */
  scope: string;
};
