import type { AuthenticationFactorMethod } from '../types.js';
import type { AuditEvent } from './types.js';

/** The factor a challenge offered or a proof satisfied. */
export interface AuditMfaFactor {
  /** How the factor is satisfied. */
  method: AuthenticationFactorMethod;
  /** Identifier of the specific factor record. */
  methodId: string;
}

/**
 * Multi-factor orchestration events.
 *
 * `mfa.challenge.skipped` matters as much as the failures. It records the gate
 * deciding a second factor was not required, which is what an auditor asks about
 * after the fact: not only "was MFA satisfied" but "why was it not demanded".
 */
export type MfaAuditEvent =
  /** A second factor was demanded, listing what would satisfy it. */
  | AuditEvent<'mfa.challenge.issued', { mfaChallengeId: string; eligibleFactors: AuditMfaFactor[] }>
  /**
   * A second factor was not required, so the primary factor stood alone.
   *
   * Recorded deliberately: a skipped step-up is a decision, and an auditor
   * reviewing an incident needs to see it was made.
   */
  | AuditEvent<'mfa.challenge.skipped', { primaryFactor: AuditMfaFactor }>
  /** A per-method challenge was dispatched. Never carries the code it dispatched. */
  | AuditEvent<'mfa.factor_challenge.issued', { mfaChallengeId: string; method: AuthenticationFactorMethod; methodId?: string }>
  /**
   * A challenge was requested against a factor it never offered.
   *
   * A probing signal rather than a user error.
   */
  | AuditEvent<'mfa.factor_challenge.ineligible', { mfaChallengeId: string; method: AuthenticationFactorMethod }>
  /** A second factor was satisfied. */
  | AuditEvent<'mfa.completed', { mfaChallengeId: string; primaryFactor: AuditMfaFactor; secondaryFactor: AuditMfaFactor }>
  /** A completion was refused. */
  | AuditEvent<'mfa.failed', { mfaChallengeId?: string; reason: MfaFailureReason; method?: AuthenticationFactorMethod }>;

/** Why {@link MfaAuditEvent} `'mfa.failed'` was recorded. */
export type MfaFailureReason =
  /** The challenge expired, was already redeemed, or never existed. */
  | 'challenge_not_found'
  /** The proof named a factor the challenge did not offer. */
  | 'factor_not_eligible'
  /** The proof's factor id did not match the one the challenge named. */
  | 'method_id_mismatch'
  /** Another completion for this challenge was already in flight. */
  | 'completion_in_flight'
  /** The underlying factor rejected the proof. */
  | 'proof_rejected'
  /**
   * The verified factor was not eligible, caught after verification.
   *
   * A defence-in-depth trip. Reaching it means the pre-check was bypassed, so
   * treat it as an attack signal rather than a user error.
   */
  | 'post_verification_mismatch';
