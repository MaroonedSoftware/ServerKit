import type { AuditEvent } from './types.js';

/** How an email challenge was delivered. */
export type AuditEmailIssueMethod = 'code' | 'magiclink';

/** Why a one-time-code challenge was refused. */
export type ChallengeFailureReason =
  /** The challenge expired, was already redeemed, or never existed. */
  | 'challenge_not_found'
  /** The factor was deactivated between issue and verify. */
  | 'no_active_factor'
  /** The code did not match. */
  | 'invalid_code'
  /**
   * The proof was presented under a delivery method the challenge was not
   * issued under — a code answering a magic link, or the reverse.
   */
  | 'method_mismatch';

/**
 * Email factor events.
 *
 * `email.challenge.verified` is a login in its own right: an email OTP or magic
 * link is how passwordless sign-in completes, not only how an address is
 * confirmed. The events never carry the code or the magic-link token, even
 * though the service returns both to its caller for delivery.
 */
export type EmailAuditEvent =
  | AuditEvent<'email.challenge.issued', { factorId: string; issueMethod: AuditEmailIssueMethod; alreadyIssued: boolean }>
  | AuditEvent<'email.challenge.verified', { factorId: string; issueMethod?: AuditEmailIssueMethod }>
  | AuditEvent<'email.challenge.failed', { factorId?: string; reason: ChallengeFailureReason }>
  /**
   * A challenge was abandoned after too many wrong codes.
   *
   * Brute force against a six-digit code, and the challenge is destroyed rather
   * than merely refused. Alert on the rate.
   */
  | AuditEvent<'email.challenge.locked', { factorId?: string; attempts: number }>
  | AuditEvent<'email.factor.created', { factorId: string }>
  | AuditEvent<'email.factor.deleted', { factorId: string }>;

/** Phone factor events. The SMS counterpart to {@link EmailAuditEvent}. */
export type PhoneAuditEvent =
  | AuditEvent<'phone.challenge.issued', { factorId: string; alreadyIssued: boolean }>
  | AuditEvent<'phone.challenge.verified', { factorId: string }>
  | AuditEvent<'phone.challenge.failed', { factorId?: string; reason: ChallengeFailureReason }>
  | AuditEvent<'phone.challenge.locked', { factorId?: string; attempts: number }>
  | AuditEvent<'phone.factor.created', { factorId: string }>
  | AuditEvent<'phone.factor.deleted', { factorId: string }>;

/** Why {@link AuthenticatorAuditEvent} `'authenticator.validation.failed'` was recorded. */
export type AuthenticatorFailureReason = 'no_active_factor' | 'invalid_code';

/**
 * Authenticator app (TOTP/HOTP) events.
 *
 * Enrolment and removal are `privilege` rather than `credential`: adding or
 * dropping a second factor changes the assurance every future session can reach,
 * and an auditor cares about an MFA factor disappearing at least as much as one
 * appearing.
 */
export type AuthenticatorAuditEvent =
  /** A secret was provisioned, but not yet activated. */
  | AuditEvent<'authenticator.registered', { label?: string }>
  /** A provisioned secret was confirmed and is now a live second factor. */
  | AuditEvent<'authenticator.enrolled', { factorId: string; label?: string }>
  | AuditEvent<'authenticator.validated', { factorId: string }>
  | AuditEvent<'authenticator.validation.failed', { factorId: string; reason: AuthenticatorFailureReason }>
  /** Too many wrong codes inside the window. The lockout signal for this factor. */
  | AuditEvent<'authenticator.validation.rate_limited', { factorId: string }>
  /**
   * A code that had already been used was presented again inside its drift window.
   *
   * Its own event, not an `invalid_code`: a correct-but-replayed code means
   * someone observed a valid one, which is interception rather than a typo.
   */
  | AuditEvent<'authenticator.validation.replayed', { factorId: string }>
  /** A second factor was removed, lowering the assurance future sessions can reach. */
  | AuditEvent<'authenticator.factor.deleted', { factorId: string }>;
