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
