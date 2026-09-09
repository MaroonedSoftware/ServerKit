import type { AuditEvent } from './types.js';

/** Why {@link PasswordAuditEvent} `'password.verify.failed'` was recorded. */
export type PasswordVerifyFailureReason =
  /** No password factor on the actor, or it has been deactivated. */
  | 'no_active_factor'
  /** The factor is flagged `needsReset`, so it will not authenticate until changed. */
  | 'reset_required'
  /** The password did not match. */
  | 'invalid_password';

/**
 * Password factor events.
 *
 * `password.verify.*` is the single most important group in the package: it is
 * where a login succeeds or fails, and none of it was recorded before.
 *
 * The rate-limit refusal is its own type rather than a `verify.failed` reason,
 * because the two mean different things operationally. A wrong password is one
 * person mistyping; a burst of rate-limit refusals is the lockout signal, and
 * collapsing them into one type makes that burst invisible in the counts.
 */
export type PasswordAuditEvent =
  /** A password authenticated an actor. */
  | AuditEvent<'password.verify.succeeded', { factorId: string }>
  /** A password did not authenticate an actor. */
  | AuditEvent<'password.verify.failed', { reason: PasswordVerifyFailureReason; factorId?: string }>
  /**
   * A verification was refused before the password was even checked.
   *
   * The lockout signal. Alert on its rate, not on individual occurrences.
   */
  | AuditEvent<'password.verify.rate_limited', Record<string, never>>
  /** A password was set on an actor for the first time. */
  | AuditEvent<'password.created', { factorId: string; needsReset: boolean }>
  /** An actor changed their own password, checked against their recent ones. */
  | AuditEvent<'password.updated', { factorId: string; needsReset: boolean }>
  /**
   * A password was replaced without a history check.
   *
   * This is the recovery path's credential change: `RecoveryOrchestrator` calls
   * it to complete a reset, so it is what an auditor looks for after a recovery.
   */
  | AuditEvent<'password.changed', { factorId: string }>
  /** A password factor was removed from an actor. */
  | AuditEvent<'password.deleted', Record<string, never>>
  /**
   * An actor's password rate limit was cleared.
   *
   * A privilege change, not bookkeeping: it lifts a lockout. Recovery calls it
   * for both `unlockAccount` and `resetPassword`, so an auditor asking "who
   * unlocked this account" is asking about this event.
   */
  | AuditEvent<'password.rate_limit_cleared', Record<string, never>>;
