import type { ApiKeyAuditEvent } from './api.key.audit.event.js';
import type { AuthenticatorAuditEvent, EmailAuditEvent, PhoneAuditEvent } from './factor.audit.event.js';
import type { MfaAuditEvent } from './mfa.audit.event.js';
import type { PasswordAuditEvent } from './password.audit.event.js';
import type { RecoveryAuditEvent } from './recovery.audit.event.js';
import type { SessionAuditEvent } from './session.audit.event.js';

/**
 * Every event this package emits.
 *
 * A discriminated union on `type`, so a consumer can switch exhaustively. Always
 * keep a `default` branch: a minor release may add a member, and an event you do
 * not recognise is still worth filing.
 */
export type AuthenticationAuditEvent =
  | SessionAuditEvent
  | ApiKeyAuditEvent
  | PasswordAuditEvent
  | EmailAuditEvent
  | PhoneAuditEvent
  | AuthenticatorAuditEvent
  | MfaAuditEvent
  | RecoveryAuditEvent;

/** `Omit` that distributes across a union instead of collapsing it to its common keys. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * What a service passes to {@link import('./audit.recorder.js').AuditRecorder.record}:
 * an event without its timestamp, which the recorder stamps.
 */
export type AuditEventInput = DistributiveOmit<AuthenticationAuditEvent, 'occurredAt'>;
