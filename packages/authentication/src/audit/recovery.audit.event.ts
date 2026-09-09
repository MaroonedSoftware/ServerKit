import type { RecoveryActionKind, RecoveryChannel, RecoveryReason } from '../recovery/types.js';
import type { AuditEvent } from './types.js';

/**
 * Account recovery events.
 *
 * Recovery is an out-of-band route to a credential change, so every step is
 * `privilege` or `credential` rather than `login`: it is how someone gets back
 * in without the factor they lost, which is exactly the path an attacker wants.
 */
export type RecoveryAuditEvent =
  /**
   * A recovery flow began.
   *
   * `actorId` is absent when the identifier matched nobody. The package still
   * issues a challenge in that case so a caller cannot probe for account
   * existence, which means an event with no actor is a **probe**, and a run of
   * them is worth alerting on.
   */
  | AuditEvent<'recovery.initiated', { challengeId: string; reason: RecoveryReason; eligibleChannelCount: number; actorResolved: boolean }>
  /** The `'auth.recovery.allowed'` policy refused a recovery attempt. */
  | AuditEvent<'recovery.policy_denied', { reason: RecoveryReason; policyReason?: string }>
  /** A per-channel challenge was dispatched. Never carries the code it dispatched. */
  | AuditEvent<'recovery.channel.issued', { challengeId: string; channel: RecoveryChannel; methodId?: string }>
  /** A channel proof was accepted and a recovery session issued with its granted actions. */
  | AuditEvent<
      'recovery.channel.verified',
      { challengeId: string; channel: RecoveryChannel; methodId?: string; grantedActions: RecoveryActionKind[] }
    >
  /**
   * A channel proof was refused.
   *
   * `sub_challenge_mismatch` is the one to alert on: it means a proof issued
   * against one account was presented on another account's challenge, which is
   * a cross-account takeover attempt and not something a legitimate client does.
   */
  | AuditEvent<'recovery.channel.rejected', { challengeId: string; channel?: RecoveryChannel; reason: RecoveryRejectionReason }>
  /** A granted recovery action was carried out. The credential change itself. */
  | AuditEvent<'recovery.completed', { action: RecoveryActionKind }>
  /** Sessions were revoked after a reset or a full recovery, with the count. */
  | AuditEvent<'recovery.sessions_revoked', { action: RecoveryActionKind; count: number }>
  /**
   * A reset or full recovery finished without revoking prior sessions.
   *
   * Emitted when no `AuthenticationSessionService` was bound to the orchestrator,
   * which silently leaves every pre-recovery token working. The event is the only
   * way that misconfiguration is visible.
   */
  | AuditEvent<'recovery.sessions_not_revoked', { action: RecoveryActionKind }>;

/** Why {@link RecoveryAuditEvent} `'recovery.channel.rejected'` was recorded. */
export type RecoveryRejectionReason =
  /** The recovery challenge expired, was redeemed, or never existed. */
  | 'challenge_not_found'
  /** The challenge never resolved to an actor, so there is nothing to recover. */
  | 'no_actor'
  /** The proof's channel was not the one the challenge selected. */
  | 'channel_mismatch'
  /**
   * The proof came from a different sub-challenge than the one this recovery
   * issued. A cross-account attempt.
   */
  | 'sub_challenge_mismatch'
  /** The verified factor is not on the challenge's eligible list. */
  | 'factor_not_eligible';
