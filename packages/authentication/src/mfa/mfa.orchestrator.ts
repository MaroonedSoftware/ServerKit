import { Injectable } from 'injectkit';
import { DateTime, Duration } from 'luxon';
import { httpError } from '@maroonedsoftware/errors';
import { isPolicyResultDenied, PolicyService } from '@maroonedsoftware/policies';
import { AuthenticationSessionService } from '../authentication.session.service.js';
import { AuthenticationFactorKind, AuthenticationFactorMethod, AuthenticationSessionFactor } from '../types.js';
import { PhoneFactorService } from '../factors/phone/phone.factor.service.js';
import { FidoFactorService } from '../factors/fido/fido.factor.service.js';
import { AuthenticatorFactorService } from '../factors/authenticator/authenticator.factor.service.js';
import { EmailFactorService } from '../factors/email/email.factor.service.js';
import { AuthMfaRequiredPolicyFactor } from '../policies/auth.mfa.required.policy.js';
import { MfaChallengeService } from './mfa.challenge.service.js';
import {
  AuthenticationTokenResponse,
  FactorChallengeProof,
  FactorChallengeStartRequest,
  FactorChallengeStartResponse,
  MfaEligibleFactor,
  TargetActor,
} from './types.js';

/**
 * Coordinates the handoff between primary and secondary authentication
 * factors. Sits on top of the per-factor services and `AuthenticationSessionService`,
 * and consults the `'auth.mfa.required'` policy to decide whether the actor
 * needs a second factor before a session is minted.
 *
 * Typical flow:
 * 1. Primary factor succeeds (password verify, OIDC callback, …).
 * 2. Caller invokes {@link issueOrChallenge}. If the policy allows, a session
 *    is minted and `{ status: 'token' }` is returned. Otherwise an MFA
 *    challenge is stashed and `{ status: 'mfa_required' }` is returned.
 * 3. Client picks a method, calls {@link startFactorChallenge} to issue a
 *    one-time code / FIDO assertion / etc. The response carries the code and
 *    recipient for `phone` and `email` — the caller is responsible for
 *    delivering it out-of-band (SMS provider, transactional email, …),
 *    matching the convention used by the per-factor services.
 * 4. Client submits the proof, caller invokes {@link completeMfa}. The
 *    challenge is redeemed (single-use), the proof is validated through the
 *    matching factor service, and the secondary factor is recorded on a new
 *    session.
 */
@Injectable()
export class MfaOrchestrator {
  constructor(
    private readonly sessionService: AuthenticationSessionService,
    private readonly challengeService: MfaChallengeService,
    private readonly policyService: PolicyService,
    private readonly phoneFactorService: PhoneFactorService,
    private readonly fidoFactorService: FidoFactorService,
    private readonly authenticatorFactorService: AuthenticatorFactorService,
    private readonly emailFactorService: EmailFactorService,
  ) {}

  /**
   * Decide whether MFA is required for `actor` having just satisfied
   * `primaryFactor`. Mints a session immediately when the policy allows, or
   * stashes an MFA challenge when it denies.
   *
   * @param actor              - The actor that authenticated.
   * @param primaryFactor      - The factor that was just satisfied.
   * @param availableFactors   - Every factor on file for the actor; the policy
   *   decides which ones qualify as a viable second factor.
   * @param claims             - Claims to embed in the resulting session.
   * @param sessionExpiration  - Optional override for session lifetime.
   * @returns `{ status: 'token', … }` on allow, `{ status: 'mfa_required', … }` on deny.
   */
  async issueOrChallenge(
    actor: TargetActor,
    primaryFactor: AuthenticationSessionFactor,
    availableFactors: AuthMfaRequiredPolicyFactor[],
    claims: Record<string, unknown>,
    sessionExpiration?: Duration,
  ): Promise<AuthenticationTokenResponse> {
    const result = await this.policyService.check('auth.mfa.required', { actor, primaryFactor, availableFactors });

    if (!isPolicyResultDenied(result)) {
      const session = await this.sessionService.createSession(actor.actorId, claims, primaryFactor, sessionExpiration);
      const token = await this.sessionService.issueTokenForSession(session.sessionToken);
      return { result: 'token', token };
    }

    const eligibleFactors = (result.details?.eligibleFactors ?? []) as MfaEligibleFactor[];

    const challenge = await this.challengeService.issue({ actor, primaryFactor, eligibleFactors });

    return {
      result: 'mfa_required',
      mfaChallengeId: challenge.challengeId,
      eligibleFactors: challenge.eligibleFactors,
      expiresAt: challenge.expiresAt,
    };
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
  async startFactorChallenge(mfaChallengeId: string, request: FactorChallengeStartRequest): Promise<FactorChallengeStartResponse> {
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
   * matching factor service. On success, mint a session that records both the
   * primary factor (from the challenge) and the secondary factor that was just
   * verified, and return a `{ status: 'token' }` response.
   *
   * @throws HTTP 404 when `mfaChallengeId` has expired or does not exist.
   * @throws HTTP 400 when the proof does not match the challenge's eligible list.
   * @throws Whatever the per-factor `verify*` call throws when the proof is invalid.
   */
  async completeMfa(
    mfaChallengeId: string,
    proof: FactorChallengeProof,
    claims: Record<string, unknown>,
    sessionExpiration?: Duration,
  ): Promise<AuthenticationTokenResponse> {
    const challenge = await this.challengeService.peek(mfaChallengeId);
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

    const session = await this.sessionService.createSession(
      challenge.actor.actorId,
      claims,
      [challenge.primaryFactor, secondaryFactor],
      sessionExpiration,
    );

    const token = await this.sessionService.issueTokenForSession(session.sessionToken);

    return { result: 'token', token };
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
