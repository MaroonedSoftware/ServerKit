import { DateTime } from 'luxon';
import { AuthenticationFactorMethod, AuthenticationSessionFactor } from '../types.js';

/**
 * A factor that may be used to satisfy a secondary MFA challenge for a given
 * actor. Surfaced to clients in an `mfa_required` response so they can let the
 * user pick a delivery method.
 */
export interface MfaEligibleFactor {
  /** The verification method backing this factor. */
  method: AuthenticationFactorMethod;
  /** Stable identifier for the underlying factor record (e.g. a DB row id). */
  methodId: string;
  /** Optional human-readable label (e.g. authenticator nickname, phone last-4) for UI factor pickers. */
  label?: string;
}

/**
 * Generic descriptor of the actor that is attempting to authenticate. Stays
 * generic in the framework — narrow `kind` in your application by passing your
 * own union (e.g. `TargetActor<'user' | 'staff' | 'system'>`).
 */
export interface TargetActor<K extends string = string> {
  /** The kind of actor (consumer-defined). */
  kind: K;
  /** Stable identifier for the actor (typically a user id). */
  actorId: string;
  /** Optional organization scope, when applicable. */
  organizationId?: string;
}

/**
 * Cached payload representing an open MFA challenge. Issued after a primary
 * factor succeeds and a policy determines that a second factor is required.
 * Single-use: redeeming the challenge atomically deletes it from cache.
 */
export interface MfaChallengePayload<K extends string = string> {
  /** Opaque identifier for the challenge; the cache key suffix. */
  challengeId: string;
  /** The actor the challenge was issued for. */
  actor: TargetActor<K>;
  /** The primary factor that has already been satisfied. */
  primaryFactor: AuthenticationSessionFactor;
  /** Factors the actor may use to complete MFA. */
  eligibleFactors: MfaEligibleFactor[];
  /** When the challenge was issued. */
  issuedAt: DateTime;
  /** When the challenge expires and may no longer be redeemed. */
  expiresAt: DateTime;
}

/**
 * Outcome of {@link MfaOrchestrator.issueOrChallenge}. Either the actor is
 * cleared to mint a single-factor session, or a challenge has been stashed
 * and the client must complete a second factor. The consumer is responsible
 * for shaping the wire response in both branches.
 */
export type IssueOrChallengeResult<K extends string = string> =
  | { kind: 'allow'; actor: TargetActor<K>; primaryFactor: AuthenticationSessionFactor }
  | { kind: 'challenge'; challenge: MfaChallengePayload<K> };

/**
 * Outcome of {@link MfaOrchestrator.completeMfa}. The MFA challenge has been
 * redeemed and the secondary factor has been verified. Caller is responsible
 * for minting the session and shaping the wire response.
 */
export interface CompleteMfaResult<K extends string = string> {
  actor: TargetActor<K>;
  primaryFactor: AuthenticationSessionFactor;
  secondaryFactor: AuthenticationSessionFactor;
}

/**
 * Request to start a per-method MFA challenge against a chosen
 * {@link MfaEligibleFactor}. Variants are discriminated on `method`.
 */
export type FactorChallengeStartRequest =
  | { method: 'phone'; methodId: string; transport?: 'sms' | 'whatsapp' }
  | { method: 'email'; methodId: string; issueMethod?: 'code' | 'magiclink' }
  | { method: 'authenticator'; methodId: string }
  | { method: 'fido'; methodId: string };

/**
 * Response returned by {@link MfaOrchestrator.startFactorChallenge}. Variants
 * match {@link FactorChallengeStartRequest} but carry the per-method payload
 * that the client needs to complete the challenge.
 */
export type FactorChallengeStartResponse =
  | {
      method: 'phone';
      challengeId: string;
      expiresAt: DateTime;
      alreadyIssued: boolean;
      transport: 'sms' | 'whatsapp';
      /** Recipient phone number (E.164) the consumer should deliver `code` to. */
      phoneNumber: string;
      /** The one-time code. The consumer is responsible for delivering it (SMS/WhatsApp). */
      code: string;
    }
  | {
      method: 'email';
      challengeId: string;
      expiresAt: DateTime;
      alreadyIssued: boolean;
      issueMethod: 'code' | 'magiclink';
      /** Recipient email address the consumer should deliver `code` to. */
      emailAddress: string;
      /** The one-time code (or magic-link token). The consumer is responsible for delivering it. */
      code: string;
    }
  | { method: 'authenticator'; methodId: string; expiresAt: DateTime }
  | {
      method: 'fido';
      challengeId: string;
      expiresAt: DateTime;
      alreadyIssued: boolean;
      /** The FIDO assertion options to pass to `navigator.credentials.get({ publicKey })`. Shape mirrors `FidoFactorService.createFidoAuthorizationChallenge`. */
      assertion: Record<string, unknown>;
    };

/**
 * Proof submitted by the client to complete a per-method MFA challenge.
 * Variants are discriminated on `method` and match
 * {@link FactorChallengeStartRequest}.
 */
export type FactorChallengeProof =
  | { method: 'phone'; challengeId: string; code: string }
  | { method: 'email'; challengeId: string; code: string }
  | { method: 'authenticator'; methodId: string; code: string }
  | { method: 'fido'; challengeId: string; credential: unknown };
