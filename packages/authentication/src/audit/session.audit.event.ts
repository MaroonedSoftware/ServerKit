import type { AuthenticationFactorKind, AuthenticationFactorMethod, SessionRevocationReason } from '../types.js';
import type { AuditEvent } from './types.js';

/**
 * How a factor appears on an audit event.
 *
 * The session's own `AuthenticationSessionFactor` minus its timestamps, which
 * the event's `occurredAt` already covers.
 */
export interface AuditSessionFactor {
  /** How the factor was satisfied. */
  method: AuthenticationFactorMethod;
  /** Identifier of the specific factor record. */
  methodId: string;
  /** MFA category. */
  kind: AuthenticationFactorKind;
}

/**
 * The session detail carried on lifecycle events.
 *
 * `claims` is passed through whole, deliberately. An application that stamps
 * request detail onto a session at login — `loginIp` and `loginUserAgent` is the
 * pattern both ServerKit consumers use — needs it back on a later revoke or
 * refresh, which happens on a different request where the live context describes
 * the wrong caller.
 *
 * That means **whatever you put in `claims` reaches your sink**. Do not store a
 * secret there.
 */
export interface AuditSessionData {
  /** The session's opaque token. */
  sessionToken: string;
  /** Refresh-token family, when the session belongs to one. */
  familyId?: string;
  /** Factors the session satisfied. */
  factors: AuditSessionFactor[];
  /** The session's claims, passed through whole. */
  claims: Record<string, unknown>;
  /** When the session expires, ISO 8601. */
  expiresAt: string;
}

/**
 * Session lifecycle events.
 *
 * These replace `AuthenticationSessionHooks`, which has been removed. Two things
 * make the events better for the job the hooks were doing: they carry a common
 * envelope, and they attribute an `actorId` at every point the service knows one
 * — including validation failures, where the hook passed only a token and forced
 * a consumer to look the session up again to file the record.
 */
export type SessionAuditEvent =
  /** A session was established. The canonical login-success record. */
  | AuditEvent<'session.created', AuditSessionData>
  /** Claims or factors changed on a live session, which can change what it may do. */
  | AuditEvent<'session.updated', AuditSessionData>
  /**
   * A session was replaced by a new one, carrying the family forward.
   *
   * One event rather than the `onSessionCreated` + `onSessionRevoked` pair the
   * hooks fire, which a consumer otherwise has to correlate by hand.
   */
  | AuditEvent<'session.rotated', AuditSessionData & { previousSessionToken: string }>
  /** A refresh token was exchanged. */
  | AuditEvent<'session.refreshed', AuditSessionData & { previousJti: string }>
  /** A session was ended. */
  | AuditEvent<'session.revoked', AuditSessionData & { reason: SessionRevocationReason }>
  /**
   * Every session for a subject was ended at once.
   *
   * Emitted alongside the per-session `session.revoked` events, and carrying the
   * count, which no hook ever sees.
   */
  | AuditEvent<'session.revoked_all', { reason: SessionRevocationReason; count: number }>
  /** A refresh-token family was torn down after a replay. Accompanies the per-session events. */
  | AuditEvent<'session.family_revoked', { familyId: string; count: number }>
  /**
   * A refresh token was presented twice.
   *
   * A theft signal, not an ordinary failure: the family has already been revoked
   * by the time this is recorded. Alert on it.
   */
  | AuditEvent<'session.refresh_reuse_detected', { familyId: string; jti: string; sessionToken?: string }>
  /**
   * A presented token did not resolve to a usable session.
   *
   * `actorId` is set whenever the service knows it, which is every case except a
   * JWT that failed to decode.
   */
  | AuditEvent<'session.validation_failed', { sessionToken?: string; reason: SessionValidationFailureReason }>;

/** Why {@link SessionAuditEvent} `'session.validation_failed'` was recorded. */
export type SessionValidationFailureReason = 'jwt_decode_failed' | 'session_not_found' | 'subject_mismatch' | 'refresh_token_invalid';
