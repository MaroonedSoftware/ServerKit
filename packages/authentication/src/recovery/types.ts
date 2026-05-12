import { DateTime } from 'luxon';
import { TargetActor } from '../mfa/types.js';

/**
 * Why the actor is attempting to recover access. Drives which channels are
 * eligible and which actions the resulting recovery session may perform.
 */
export type RecoveryReason = 'password_reset' | 'mfa_recovery' | 'unlock' | 'full_recovery';

/**
 * A channel that may be used to satisfy a recovery challenge. `email` and
 * `phone` reuse the verified factor of the same name; `recoveryCode` redeems
 * one of the actor's pre-generated backup codes.
 */
export type RecoveryChannel = 'email' | 'phone' | 'recoveryCode';

/**
 * The set of mutations a recovery session is allowed to perform once minted.
 * Determined by {@link RecoveryReason} (and policy overrides) and stamped on
 * the recovery session at verification time so {@link RecoveryOrchestrator.completeRecovery}
 * can enforce the grant without re-consulting policy.
 */
export type RecoveryActionKind = 'resetPassword' | 'unlockAccount' | 'rebindMfaFactor' | 'fullRecovery';

/**
 * A channel the actor may pick to satisfy a recovery challenge.
 *
 * `channel === 'email' | 'phone'` carry the underlying factor's `methodId` so
 * the consumer can render a picker; `channel === 'recoveryCode'` has no
 * methodId — the code is the proof.
 */
export interface RecoveryEligibleChannel {
  channel: RecoveryChannel;
  methodId?: string;
  /** Optional human-readable label (e.g. partially-masked email or phone number). */
  label?: string;
}

/**
 * Cached payload representing an open recovery challenge. Single-use: the
 * challenge is deleted from cache when redeemed by {@link RecoveryOrchestrator.verifyChannel}.
 */
export interface RecoveryChallengePayload<K extends string = string> {
  /** Opaque identifier for the recovery challenge; the cache key suffix. */
  challengeId: string;
  /** Resolved actor when the identifier was recognised; `undefined` when policy allowed an anonymous challenge to prevent user enumeration. */
  actor?: TargetActor<K>;
  /** Why the actor is attempting to recover. */
  reason: RecoveryReason;
  /** Channels the actor may use to complete recovery. */
  eligibleChannels: RecoveryEligibleChannel[];
  /** The channel the actor has selected, after {@link RecoveryOrchestrator.issueChannelChallenge}. */
  selectedChannel?: RecoveryChannel;
  /** Reference to the per-factor sub-challenge for `email` / `phone` channels. */
  channelChallengeId?: string;
  issuedAt: DateTime;
  expiresAt: DateTime;
}

/**
 * Cached payload representing a verified recovery session. Carries the grants
 * derived from the verification reason + channel pairing. **Not** an
 * {@link AuthenticationSession} — the token has no JWT issuance path and the
 * cache key prefix is distinct, so a recovery session cannot authorise
 * application endpoints.
 */
export interface RecoverySessionPayload<K extends string = string> {
  /** Opaque, single-use token. The cache key suffix. */
  recoverySessionToken: string;
  actor: TargetActor<K>;
  reason: RecoveryReason;
  verifiedVia: { channel: RecoveryChannel; methodId?: string };
  /** Action kinds the holder may pass to {@link RecoveryOrchestrator.completeRecovery}. */
  grantedActions: RecoveryActionKind[];
  issuedAt: DateTime;
  expiresAt: DateTime;
}

/** Identifier used to initiate recovery when the caller doesn't already have the actor id. */
export type RecoveryIdentifier = { kind: 'email'; value: string } | { kind: 'phone'; value: string };

/**
 * Input for {@link RecoveryOrchestrator.initiateRecovery}. Exactly one of
 * `actorId` or `identifier` should be supplied.
 */
export interface InitiateRecoveryInput<K extends string = string> {
  /** The actor id, when the caller already knows it (e.g. a re-authenticated user clicking "forgot password" from settings). */
  actorId?: string;
  /** A bare identifier, used when the actor id is not known (e.g. an unauthenticated forgot-password form). */
  identifier?: RecoveryIdentifier;
  /** Why the actor is recovering. */
  reason: RecoveryReason;
  /** Optional actor kind to stamp on the resolved {@link TargetActor}. */
  actorKind?: K;
}

/** Outcome of {@link RecoveryOrchestrator.initiateRecovery}. */
export interface InitiateRecoveryResult {
  challengeId: string;
  eligibleChannels: RecoveryEligibleChannel[];
  expiresAt: DateTime;
}

/** Request to issue a per-channel recovery challenge. */
export type RecoveryChannelChallengeRequest =
  | { channel: 'email'; methodId: string; issueMethod?: 'code' | 'magiclink' }
  | { channel: 'phone'; methodId: string }
  | { channel: 'recoveryCode' };

/** Response from {@link RecoveryOrchestrator.issueChannelChallenge}. */
export type RecoveryChannelChallengeResponse =
  | {
      channel: 'email';
      challengeId: string;
      expiresAt: DateTime;
      alreadyIssued: boolean;
      issueMethod: 'code' | 'magiclink';
      /** Recipient email address the consumer should deliver `code` to. */
      emailAddress: string;
      /** The one-time code or magic-link token. The consumer is responsible for delivering it. */
      code: string;
    }
  | {
      channel: 'phone';
      challengeId: string;
      expiresAt: DateTime;
      alreadyIssued: boolean;
      /** Recipient phone number (E.164) the consumer should deliver `code` to. */
      phoneNumber: string;
      /** The one-time code. The consumer is responsible for delivering it (SMS/WhatsApp). */
      code: string;
    }
  | { channel: 'recoveryCode'; expiresAt: DateTime };

/** Proof submitted by the client to verify a recovery channel. */
export type RecoveryProof =
  | { channel: 'email'; channelChallengeId: string; code: string }
  | { channel: 'phone'; channelChallengeId: string; code: string }
  | { channel: 'recoveryCode'; code: string };

/** Outcome of {@link RecoveryOrchestrator.verifyChannel}. */
export interface VerifyChannelResult {
  recoverySessionToken: string;
  expiresAt: DateTime;
  grantedActions: RecoveryActionKind[];
}

/**
 * Action the holder of a recovery session asks the orchestrator to perform.
 * Variants are discriminated on `kind`.
 *
 * `identityProof` for `fullRecovery` is a caller-defined blob that has already
 * been validated upstream — the package is intentionally agnostic about KYC /
 * admin workflows.
 */
export type RecoveryAction =
  | { kind: 'resetPassword'; newPassword: string }
  | { kind: 'unlockAccount' }
  | { kind: 'rebindMfaFactor'; method: 'phone' | 'email' | 'authenticator' | 'fido'; methodId?: string }
  | { kind: 'fullRecovery'; identityProof: unknown };

/** Outcome of {@link RecoveryOrchestrator.completeRecovery}. */
export interface CompleteRecoveryResult<K extends string = string> {
  actor: TargetActor<K>;
  action: RecoveryAction;
  performedAt: DateTime;
}
