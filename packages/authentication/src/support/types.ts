import { DateTime } from 'luxon';

/**
 * The current support-verification code for an actor.
 *
 * Returned by {@link import('./support.verification.code.service.js').SupportVerificationCodeService.issueCode}.
 * The code rotates every `periodSeconds`; clients should re-call `issueCode`
 * (or compute the next period locally) to display the next value.
 */
export interface SupportVerificationIssueResult {
  /** The current verification code, zero-padded to the configured token length. */
  code: string;
  /** OTP rotation period in seconds. */
  periodSeconds: number;
  /** When the current period was entered. */
  issuedAt: DateTime;
  /** When the current period ends and the code rotates. */
  expiresAt: DateTime;
}

/** Outcome of a successful {@link import('./support.verification.code.service.js').SupportVerificationCodeService.verifyCode} call. */
export interface SupportVerificationVerifyResult {
  /** The actor the code was verified against. */
  actorId: string;
  /** The TOTP counter (period index) the matching code corresponded to. */
  counter: number;
  /** When the verification succeeded. */
  verifiedAt: DateTime;
}
