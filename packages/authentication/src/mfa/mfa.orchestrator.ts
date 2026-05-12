import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { httpError } from '@maroonedsoftware/errors';
import { isPolicyResultDenied, PolicyService } from '@maroonedsoftware/policies';
import { AuthenticationFactorKind, AuthenticationFactorMethod, AuthenticationSessionFactor } from '../types.js';
import { PhoneFactorService } from '../factors/phone/phone.factor.service.js';
import { FidoFactorService } from '../factors/fido/fido.factor.service.js';
import { AuthenticatorFactorService } from '../factors/authenticator/authenticator.factor.service.js';
import { EmailFactorService } from '../factors/email/email.factor.service.js';
import { AuthMfaRequiredPolicyFactor } from '../policies/auth.mfa.required.policy.js';
import { MfaChallengeService } from './mfa.challenge.service.js';
import {
  CompleteMfaResult,
  FactorChallengeProof,
  FactorChallengeStartRequest,
  FactorChallengeStartResponse,
  IssueOrChallengeResult,
  MfaChallengePayload,
  MfaEligibleFactor,
  TargetActor,
} from './types.js';

/**
 * Coordinates the handoff between primary and secondary authentication
 * factors. Sits on top of the per-factor services and consults the
 * `'auth.session.mfa.required'` policy to decide whether the actor needs a second
 * factor before a session is minted.
 *
 * The orchestrator is a pure state machine — it does not mint sessions or
 * shape wire responses. Callers receive structured data and are responsible
 * for issuing tokens and translating to their HTTP contract.
 *
 * Typical flow:
 * 1. Primary factor succeeds (password verify, OIDC callback, …).
 * 2. Caller invokes {@link issueOrChallenge}. On `kind: 'allow'` the caller
 *    mints a single-factor session. On `kind: 'challenge'` a challenge has
 *    been stashed and the caller surfaces the challenge details to the client.
 * 3. Client picks a method, caller invokes {@link issueFactorChallenge} to
 *    issue a one-time code / FIDO assertion / etc. The response carries the
 *    code and recipient for `phone` and `email` — the caller is responsible
 *    for delivering it out-of-band (SMS provider, transactional email, …),
 *    matching the convention used by the per-factor services.
 * 4. Client submits the proof, caller invokes {@link completeMfa}. The
 *    challenge is redeemed (single-use), the proof is validated through the
 *    matching factor service, and the verified secondary factor is returned
 *    alongside the primary factor and actor so the caller can mint a session.
 */
@Injectable()
export class MfaOrchestrator {
  constructor(
    private readonly challengeService: MfaChallengeService,
    private readonly policyService: PolicyService,
    private readonly phoneFactorService: PhoneFactorService,
    private readonly fidoFactorService: FidoFactorService,
    private readonly authenticatorFactorService: AuthenticatorFactorService,
    private readonly emailFactorService: EmailFactorService,
  ) {}

  /**
   * Decide whether MFA is required for `actor` having just satisfied
   * `primaryFactor`. Returns `{ kind: 'allow' }` when the policy allows, or
   * stashes an MFA challenge and returns `{ kind: 'challenge' }` when it
   * denies.
   *
   * @param actor              - The actor that authenticated.
   * @param primaryFactor      - The factor that was just satisfied.
   * @param availableFactors   - Every factor on file for the actor; the policy
   *   decides which ones qualify as a viable second factor.
   * @returns A discriminated union the caller branches on to mint a session
   *   (`allow`) or surface the challenge details to the client (`challenge`).
   */
  async issueOrChallenge<K extends string = string>(
    actor: TargetActor<K>,
    primaryFactor: AuthenticationSessionFactor,
    availableFactors: AuthMfaRequiredPolicyFactor[],
  ): Promise<IssueOrChallengeResult<K>> {
    const result = await this.policyService.check('auth.session.mfa.required', { actor, primaryFactor, availableFactors });

    if (!isPolicyResultDenied(result)) {
      return { kind: 'allow', actor, primaryFactor };
    }

    const eligibleFactors = (result.details?.eligibleFactors ?? []) as MfaEligibleFactor[];
    const challenge = (await this.challengeService.issue({ actor, primaryFactor, eligibleFactors })) as MfaChallengePayload<K>;
    return { kind: 'challenge', challenge };
  }

  /**
   * Issue a per-method challenge against the {@link MfaEligibleFactor} the
   * client selected. The MFA challenge must still be pending (use
   * {@link MfaChallengeService.peek}).
   *
   * For `phone` and `email`, the response includes the recipient and the
   * one-time `code` — the caller is responsible for delivering it out-of-band
   * (SMS provider, transactional email, …). This matches the convention used
   * by `PhoneFactorService.issuePhoneChallenge` and
   * `EmailFactorService.issueEmailChallenge` directly.
   *
   * @throws HTTP 404 when `mfaChallengeId` has expired or does not exist.
   * @throws HTTP 400 when the selected method/methodId is not on the
   *   challenge's eligible list.
   */
  async issueFactorChallenge(mfaChallengeId: string, request: FactorChallengeStartRequest): Promise<FactorChallengeStartResponse> {
    const challenge = await this.challengeService.peek(mfaChallengeId);
    if (!challenge) {
      throw httpError(404).withDetails({ mfaChallengeId: 'not found' });
    }

    const eligible = challenge.eligibleFactors.find(f => f.method === request.method && f.methodId === request.methodId);
    if (!eligible) {
      throw httpError(400).withDetails({ method: 'not eligible for this challenge' });
    }

    const { actorId } = challenge.actor;

    switch (request.method) {
      case 'phone': {
        const result = await this.phoneFactorService.issuePhoneChallenge(actorId, request.methodId);
        return {
          method: 'phone',
          challengeId: result.challengeId,
          expiresAt: result.expiresAt,
          alreadyIssued: result.alreadyIssued,
          transport: request.transport ?? 'sms',
          phoneNumber: result.phone,
          code: result.code,
        };
      }

      case 'email': {
        const issueMethod = request.issueMethod ?? 'code';
        const result = await this.emailFactorService.issueEmailChallenge(actorId, request.methodId, issueMethod);
        return {
          method: 'email',
          challengeId: result.challengeId,
          expiresAt: result.expiresAt,
          alreadyIssued: result.alreadyIssued,
          issueMethod,
          emailAddress: result.email,
          code: result.code,
        };
      }

      case 'fido': {
        const result = await this.fidoFactorService.createFidoAuthorizationChallenge(actorId, request.methodId);
        return {
          method: 'fido',
          challengeId: result.challengeId,
          expiresAt: result.expiresAt,
          alreadyIssued: result.alreadyIssued,
          assertion: result.assertion as unknown as Record<string, unknown>,
        };
      }

      case 'authenticator': {
        return {
          method: 'authenticator',
          methodId: request.methodId,
          expiresAt: challenge.expiresAt,
        };
      }
    }
  }

  /**
   * Redeem the MFA challenge and validate the submitted proof through the
   * matching factor service. On success, return the actor, the primary factor
   * (carried over from the challenge), and the verified secondary factor. The
   * caller is responsible for minting a session and shaping the wire response.
   *
   * @throws HTTP 404 when `mfaChallengeId` has expired or does not exist.
   * @throws HTTP 400 when the proof does not match the challenge's eligible list.
   * @throws Whatever the per-factor `verify*` call throws when the proof is invalid.
   */
  async completeMfa<K extends string = string>(mfaChallengeId: string, proof: FactorChallengeProof): Promise<CompleteMfaResult<K>> {
    const challenge = (await this.challengeService.peek(mfaChallengeId)) as MfaChallengePayload<K> | null;
    if (!challenge) {
      throw httpError(404).withDetails({ mfaChallengeId: 'not found' });
    }

    const verifiedFactor = await this.verifyProof(challenge.actor.actorId, proof);

    const matchesEligible = challenge.eligibleFactors.some(f => f.method === verifiedFactor.method && f.methodId === verifiedFactor.methodId);
    if (!matchesEligible) {
      throw httpError(400).withDetails({ method: 'proof does not match an eligible factor' });
    }

    await this.challengeService.redeem(mfaChallengeId);

    const secondaryFactor: AuthenticationSessionFactor = {
      method: verifiedFactor.method,
      methodId: verifiedFactor.methodId,
      kind: verifiedFactor.kind,
      issuedAt: DateTime.utc(),
      authenticatedAt: DateTime.utc(),
    };

    return { actor: challenge.actor, primaryFactor: challenge.primaryFactor, secondaryFactor };
  }

  private async verifyProof(
    actorId: string,
    proof: FactorChallengeProof,
  ): Promise<{ method: AuthenticationFactorMethod; methodId: string; kind: AuthenticationFactorKind }> {
    switch (proof.method) {
      case 'phone': {
        const factor = await this.phoneFactorService.verifyPhoneChallenge(proof.challengeId, proof.code);
        return { method: 'phone', methodId: factor.id, kind: 'possession' };
      }
      case 'email': {
        const factor = await this.emailFactorService.verifyEmailChallenge(proof.challengeId, proof.code);
        return { method: 'email', methodId: factor.id, kind: 'possession' };
      }
      case 'authenticator': {
        const factor = await this.authenticatorFactorService.validateFactor(actorId, proof.methodId, proof.code);
        return { method: 'authenticator', methodId: factor.id, kind: 'possession' };
      }
      case 'fido': {
        const factor = await this.fidoFactorService.verifyFidoAuthorizationChallenge(
          proof.challengeId,
          proof.credential as Parameters<FidoFactorService['verifyFidoAuthorizationChallenge']>[1],
        );
        return { method: 'fido', methodId: factor.id, kind: 'possession' };
      }
    }
  }
}
