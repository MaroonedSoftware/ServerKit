import { Injectable } from 'injectkit';
import { DateTime } from 'luxon';
import { httpError } from '@maroonedsoftware/errors';
import { isPolicyResultDenied, PolicyService } from '@maroonedsoftware/policies';
import { EmailFactorService } from '../factors/email/email.factor.service.js';
import { PhoneFactorService } from '../factors/phone/phone.factor.service.js';
import { PasswordFactorService } from '../factors/password/password.factor.service.js';
import { RecoveryFactorService } from '../factors/recovery/recovery.factor.service.js';
import { TargetActor } from '../mfa/types.js';
import { AuthenticationSessionService } from '../authentication.session.service.js';
import { maskEmail, maskPhone } from '../helpers.js';
import { AuditRecorder } from '../audit/audit.recorder.js';
import type { RecoveryRejectionReason } from '../audit/recovery.audit.event.js';
import { RecoveryChallengeService } from './recovery.challenge.service.js';
import { RecoverySessionService } from './recovery.session.service.js';
import {
  CompleteRecoveryResult,
  InitiateRecoveryInput,
  InitiateRecoveryResult,
  RecoveryAction,
  RecoveryActionKind,
  RecoveryChannel,
  RecoveryChannelChallengeRequest,
  RecoveryChannelChallengeResponse,
  RecoveryEligibleChannel,
  RecoveryProof,
  RecoveryReason,
  VerifyChannelResult,
} from './types.js';

/**
 * Action kinds granted by each {@link RecoveryReason} once a channel has been
 * verified. The orchestrator stamps these on the recovery session at
 * {@link RecoveryOrchestrator.verifyChannel} time, and
 * {@link RecoveryOrchestrator.completeRecovery} enforces them without
 * re-consulting policy.
 */
const grantedActionsByReason: Record<RecoveryReason, RecoveryActionKind[]> = {
  password_reset: ['resetPassword'],
  mfa_recovery: ['rebindMfaFactor'],
  unlock: ['unlockAccount'],
  full_recovery: ['fullRecovery', 'resetPassword', 'rebindMfaFactor'],
};

/**
 * Hooks the orchestrator can invoke at completion time. Optional escape hatches
 * for the consuming app — none of the package's bundled services use them.
 */
export interface RecoveryOrchestratorHooks {
  /** Called after a successful `unlockAccount` action. Use to clear additional rate limiters or unlock other subsystems. */
  onUnlock?: (actorId: string) => Promise<void>;
  /** Called after a successful `fullRecovery` action to apply the caller-supplied identity proof. */
  onFullRecovery?: (input: { actorId: string; identityProof: unknown }) => Promise<void>;
  /** Called when the orchestrator needs to bind a fresh MFA factor. The caller knows the factor setup format; the orchestrator hands off. */
  onRebindMfaFactor?: (input: { actorId: string; method: 'phone' | 'email' | 'authenticator' | 'fido'; methodId?: string }) => Promise<void>;
}

/**
 * Wraps {@link RecoveryOrchestratorHooks} for injection. Register a subclass
 * in your DI container to supply the actual hook implementations; the default
 * provider's `hooks` is empty so the orchestrator no-ops on the optional
 * fan-out points.
 */
@Injectable()
export class RecoveryOrchestratorHooksProvider {
  constructor(public readonly hooks: RecoveryOrchestratorHooks = {}) {}
}

/**
 * Coordinates account recovery as a pure state machine. Parallel to
 * {@link MfaOrchestrator}: returns structured data and lets the consuming app
 * shape wire responses, deliver out-of-band codes, and mint authentication
 * sessions after recovery completes.
 *
 * State machine:
 *
 * 1. {@link initiateRecovery} — resolve the actor, consult
 *    `'auth.recovery.allowed'`, stash a parent challenge with the eligible channels.
 *    For unknown identifiers, the policy is consulted with an absent actor and
 *    by default returns `allow`; the orchestrator returns a challenge with an
 *    empty `eligibleChannels` list so the caller cannot probe for account
 *    existence.
 * 2. {@link issueChannelChallenge} — the caller picks a channel; the
 *    orchestrator dispatches to the matching factor service for OTP issuance
 *    (email / phone) or returns a stub for recovery-code redemption. The
 *    sub-challenge id is stitched onto the parent challenge.
 * 3. {@link verifyChannel} — the caller submits the channel proof; the
 *    orchestrator verifies through the factor service, redeems the parent
 *    challenge, mints a recovery session whose `grantedActions` is derived
 *    from `reason`.
 * 4. {@link completeRecovery} — the caller submits an action consistent with
 *    `grantedActions`. The orchestrator dispatches to the relevant factor
 *    service (or hook) and redeems the recovery session.
 *
 * When an {@link AuthenticationSessionService} is supplied, `resetPassword` and
 * `fullRecovery` revoke the actor's existing authentication sessions (reason
 * `'recovery'`) so tokens minted before the recovery stop working. Construct the
 * orchestrator without one and that step is the caller's responsibility.
 */
@Injectable()
export class RecoveryOrchestrator {
  constructor(
    private readonly challengeService: RecoveryChallengeService,
    private readonly sessionService: RecoverySessionService,
    private readonly policyService: PolicyService,
    private readonly emailFactorService: EmailFactorService,
    private readonly phoneFactorService: PhoneFactorService,
    private readonly passwordFactorService: PasswordFactorService,
    private readonly recoveryFactorService: RecoveryFactorService,
    private readonly hooksProvider: RecoveryOrchestratorHooksProvider = new RecoveryOrchestratorHooksProvider(),
    /**
     * Used to revoke the actor's existing authentication sessions after a
     * `resetPassword` or `fullRecovery`. Optional so the orchestrator can still be
     * constructed standalone; bind it in DI (as any app using sessions already does)
     * and the revocation happens by default.
     */
    private readonly authenticationSessionService?: AuthenticationSessionService,
    /** Records recovery progress and the credential changes it authorises. Defaulted, so audit is opt-in. */
    private readonly audit: AuditRecorder = new AuditRecorder(),
  ) {}

  /** Record a refused channel proof. */
  private async auditRejected(challengeId: string, reason: RecoveryRejectionReason, actorId?: string, channel?: RecoveryChannel) {
    await this.audit.record({
      type: 'recovery.channel.rejected',
      category: 'recovery',
      outcome: 'failure',
      ...(actorId === undefined ? {} : { actorId }),
      data: { challengeId, reason, ...(channel === undefined ? {} : { channel }) },
    });
  }

  /**
   * Resolve `input` to an actor when possible. Returns `undefined` when no
   * actor can be located — the orchestrator deliberately surfaces the same
   * empty-channels challenge in that case to avoid leaking which identifiers
   * exist.
   */
  private async resolveActor<K extends string>(input: InitiateRecoveryInput<K>): Promise<TargetActor<K> | undefined> {
    if (input.actorId) {
      return { kind: (input.actorKind ?? 'user') as K, actorId: input.actorId };
    }
    if (input.identifier?.kind === 'email') {
      const factor = await this.emailFactorService.findFactor(input.identifier.value);
      if (factor) {
        return { kind: (input.actorKind ?? 'user') as K, actorId: factor.actorId };
      }
    }
    // Phone-by-identifier is intentionally not resolved by this package — phone
    // numbers are not guaranteed globally unique in the framework's data model,
    // and the consuming app is the right place to decide the resolution rule.
    // Pre-resolve the actor and pass `actorId` directly when initiating phone
    // recovery.
    return undefined;
  }

  /**
   * Compute eligible channels for an actor and reason from the factors on file.
   *
   * Labels are masked: `initiateRecovery` is reachable pre-authentication, so a
   * caller who knows an email address must not be handed that account's other
   * contact details in full. The unmasked recipient is returned only by
   * {@link issueChannelChallenge}, which is bound to a selected channel.
   */
  private async eligibleChannelsFor(actor: TargetActor, reason: RecoveryReason): Promise<RecoveryEligibleChannel[]> {
    const channels: RecoveryEligibleChannel[] = [];

    const emails = await this.emailFactorService.listFactors(actor.actorId, true);
    for (const email of emails) {
      channels.push({ channel: 'email', methodId: email.id, label: maskEmail(email.value) });
    }

    const phones = await this.phoneFactorService.listFactors(actor.actorId, true);
    for (const phone of phones) {
      channels.push({ channel: 'phone', methodId: phone.id, label: maskPhone(phone.value) });
    }

    if (reason === 'mfa_recovery' || reason === 'full_recovery') {
      const codeCount = await this.recoveryFactorService.countRemainingCodes(actor.actorId);
      if (codeCount > 0) {
        channels.push({ channel: 'recoveryCode' });
      }
    }

    if (reason === 'password_reset') {
      // Password reset must not be initiated through a recovery-code channel —
      // codes are reserved for situations where the primary factor is lost.
      return channels.filter(c => c.channel !== 'recoveryCode');
    }

    return channels;
  }

  /**
   * Begin a recovery flow.
   *
   * Always returns a challenge when the policy allows — including the case
   * where the supplied identifier doesn't match any actor — so callers cannot
   * use the response to enumerate accounts. The returned `eligibleChannels`
   * will be empty in that case.
   *
   * @throws HTTP 403 when the `'auth.recovery.allowed'` policy denies.
   */
  async initiateRecovery<K extends string = string>(input: InitiateRecoveryInput<K>): Promise<InitiateRecoveryResult> {
    const actor = await this.resolveActor(input);

    const eligibleChannels = actor ? await this.eligibleChannelsFor(actor, input.reason) : [];

    const policyResult = await this.policyService.check('auth.recovery.allowed', {
      actor,
      reason: input.reason,
      eligibleChannels,
    });
    if (isPolicyResultDenied(policyResult)) {
      await this.audit.record({
        type: 'recovery.policy_denied',
        category: 'recovery',
        outcome: 'failure',
        ...(actor === undefined ? {} : { actorId: actor.actorId }),
        data: { reason: input.reason, ...(policyResult.reason === undefined ? {} : { policyReason: policyResult.reason }) },
      });
      throw httpError(403)
        .withDetails({ reason: policyResult.reason })
        .withInternalDetails(policyResult.details ?? {});
    }

    const challenge = await this.challengeService.issue({
      actor,
      reason: input.reason,
      eligibleChannels,
    });

    // `actorResolved: false` is a probe: the package still issues a challenge for
    // an unknown identifier so a caller cannot enumerate accounts, which means a
    // run of these is someone testing addresses. Alert on the rate.
    await this.audit.record({
      type: 'recovery.initiated',
      category: 'recovery',
      outcome: 'success',
      ...(actor === undefined ? {} : { actorId: actor.actorId }),
      data: {
        challengeId: challenge.challengeId,
        reason: input.reason,
        eligibleChannelCount: eligibleChannels.length,
        actorResolved: actor !== undefined,
      },
    });

    return {
      challengeId: challenge.challengeId,
      eligibleChannels,
      expiresAt: challenge.expiresAt,
    };
  }

  /**
   * Issue a per-channel sub-challenge against the recovery challenge.
   *
   * For `email` / `phone` channels, delegates to the matching factor service's
   * `issue*Challenge` method; the response carries the OTP code and recipient
   * for the consumer to deliver out-of-band. For `recoveryCode`, no
   * sub-challenge is issued — the code itself is the proof — and the response
   * simply confirms the challenge is open.
   *
   * @throws HTTP 404 when the recovery challenge has expired or does not exist.
   * @throws HTTP 400 when the selected channel is not on the eligible list.
   */
  async issueChannelChallenge(challengeId: string, request: RecoveryChannelChallengeRequest): Promise<RecoveryChannelChallengeResponse> {
    const challenge = await this.challengeService.peek(challengeId);
    if (!challenge) {
      throw httpError(404).withDetails({ challengeId: 'not found' });
    }
    if (!challenge.actor) {
      throw httpError(400).withDetails({ challengeId: 'no actor resolved for this challenge' });
    }

    const eligible = challenge.eligibleChannels.find(c => {
      if (c.channel !== request.channel) return false;
      if (request.channel === 'recoveryCode') return true;
      return c.methodId === request.methodId;
    });
    if (!eligible) {
      await this.auditRejected(challengeId, 'factor_not_eligible', challenge.actor.actorId, request.channel);
      throw httpError(400).withDetails({ channel: 'not eligible for this challenge' });
    }

    const { actorId } = challenge.actor;

    // Recorded before dispatch, and never carrying the code the response holds.
    await this.audit.record({
      type: 'recovery.channel.issued',
      category: 'recovery',
      outcome: 'success',
      actorId,
      data: { challengeId, channel: request.channel, ...('methodId' in request && request.methodId ? { methodId: request.methodId } : {}) },
    });

    switch (request.channel) {
      case 'email': {
        const issueMethod = request.issueMethod ?? 'code';
        const result = await this.emailFactorService.issueEmailChallenge(actorId, request.methodId, issueMethod);
        await this.challengeService.attachChannelSelection(challengeId, { selectedChannel: 'email', channelChallengeId: result.challengeId });
        return {
          channel: 'email',
          challengeId: result.challengeId,
          expiresAt: result.expiresAt,
          alreadyIssued: result.alreadyIssued,
          issueMethod,
          emailAddress: result.email,
          code: result.code,
        };
      }
      case 'phone': {
        const result = await this.phoneFactorService.issuePhoneChallenge(actorId, request.methodId);
        await this.challengeService.attachChannelSelection(challengeId, { selectedChannel: 'phone', channelChallengeId: result.challengeId });
        return {
          channel: 'phone',
          challengeId: result.challengeId,
          expiresAt: result.expiresAt,
          alreadyIssued: result.alreadyIssued,
          phoneNumber: result.phone,
          code: result.code,
        };
      }
      case 'recoveryCode': {
        await this.challengeService.attachChannelSelection(challengeId, { selectedChannel: 'recoveryCode' });
        return { channel: 'recoveryCode', expiresAt: challenge.expiresAt };
      }
    }
  }

  /**
   * Verify the proof for a per-channel sub-challenge. On success the parent
   * recovery challenge is redeemed (single-use) and a recovery session is
   * minted whose `grantedActions` are derived from the original `reason`.
   *
   * The proof is bound to the parent challenge two ways: for `email` / `phone` the
   * `channelChallengeId` must be the one {@link issueChannelChallenge} stitched on, and
   * the factor the proof resolves to must appear in the challenge's `eligibleChannels`.
   * Both are required so a sub-challenge issued against another account cannot be
   * redeemed here.
   *
   * @throws HTTP 404 when the recovery challenge has expired or does not exist, or when an
   *   email proof carries an `issueMethod` the underlying channel challenge was not issued under.
   * @throws HTTP 400 when the proof's channel doesn't match the selected channel, when the
   *   proof's `channelChallengeId` is not the one this challenge issued, or when the verified
   *   factor is not on the challenge's eligible list.
   * @throws Whatever the per-factor `verify*` call throws when the proof is invalid.
   */
  async verifyChannel<K extends string = string>(challengeId: string, proof: RecoveryProof): Promise<VerifyChannelResult> {
    const challenge = await this.challengeService.peek(challengeId);
    if (!challenge) {
      await this.auditRejected(challengeId, 'challenge_not_found', undefined, proof.channel);
      throw httpError(404).withDetails({ challengeId: 'not found' });
    }
    if (!challenge.actor) {
      await this.auditRejected(challengeId, 'no_actor', undefined, proof.channel);
      throw httpError(400).withDetails({ challengeId: 'no actor resolved for this challenge' });
    }
    if (challenge.selectedChannel && challenge.selectedChannel !== proof.channel) {
      await this.auditRejected(challengeId, 'channel_mismatch', challenge.actor.actorId, proof.channel);
      throw httpError(400).withDetails({ channel: 'does not match the selected channel' });
    }

    // The proof must name the very sub-challenge this recovery challenge issued.
    // Without this gate, a sub-challenge issued against the attacker's own email or
    // phone factor could be redeemed against a parent challenge bound to a different
    // actor, minting that actor's recovery session.
    if (proof.channel !== 'recoveryCode') {
      if (!challenge.channelChallengeId) {
        await this.auditRejected(challengeId, 'sub_challenge_mismatch', challenge.actor.actorId, proof.channel);
        throw httpError(400).withDetails({ channelChallengeId: 'no channel challenge has been issued for this recovery challenge' });
      }
      if (proof.channelChallengeId !== challenge.channelChallengeId) {
        // A proof issued against one account presented on another's challenge.
        // No legitimate client does this: alert on it.
        await this.auditRejected(challengeId, 'sub_challenge_mismatch', challenge.actor.actorId, proof.channel);
        throw httpError(400).withDetails({ channelChallengeId: 'does not match the issued channel challenge' });
      }
    }

    const verifiedVia: { channel: RecoveryChannel; methodId?: string } = await this.verifyProof(challenge.actor.actorId, proof);

    // Defence in depth, mirroring `MfaOrchestrator.completeMfa`: the factor the proof
    // resolved to has to be one this challenge listed as eligible for its own actor.
    const matchesEligible = challenge.eligibleChannels.some(
      c => c.channel === verifiedVia.channel && (c.channel === 'recoveryCode' || c.methodId === verifiedVia.methodId),
    );
    if (!matchesEligible) {
      await this.auditRejected(challengeId, 'factor_not_eligible', challenge.actor.actorId, verifiedVia.channel);
      throw httpError(400).withDetails({ channel: 'not eligible for this challenge' });
    }

    await this.challengeService.redeem(challengeId);

    const grantedActions = grantedActionsByReason[challenge.reason];

    const session = await this.sessionService.issue({
      actor: challenge.actor as TargetActor<K>,
      reason: challenge.reason,
      verifiedVia,
      grantedActions,
    });

    // The out-of-band privilege grant: this is the moment someone gets the right
    // to change a credential without the factor they lost.
    await this.audit.record({
      type: 'recovery.channel.verified',
      category: 'privilege',
      outcome: 'success',
      actorId: challenge.actor.actorId,
      data: {
        challengeId,
        channel: verifiedVia.channel,
        ...(verifiedVia.methodId === undefined ? {} : { methodId: verifiedVia.methodId }),
        grantedActions: [...grantedActions],
      },
    });

    return {
      recoverySessionToken: session.recoverySessionToken,
      expiresAt: session.expiresAt,
      grantedActions,
    };
  }

  private async verifyProof(actorId: string, proof: RecoveryProof): Promise<{ channel: RecoveryChannel; methodId?: string }> {
    switch (proof.channel) {
      case 'email': {
        const factor = await this.emailFactorService.verifyEmailChallenge(proof.channelChallengeId, proof.code, proof.issueMethod);
        return { channel: 'email', methodId: factor.id };
      }
      case 'phone': {
        const factor = await this.phoneFactorService.verifyPhoneChallenge(proof.channelChallengeId, proof.code);
        return { channel: 'phone', methodId: factor.id };
      }
      case 'recoveryCode': {
        const factor = await this.recoveryFactorService.verifyRecoveryCode(actorId, proof.code);
        return { channel: 'recoveryCode', methodId: factor.id };
      }
    }
  }

  /**
   * Complete a recovery flow by performing an action authorised by the
   * recovery session. The session is single-use and is redeemed regardless of
   * action success.
   *
   * A successful `resetPassword` or `fullRecovery` revokes the actor's existing
   * authentication sessions when an {@link AuthenticationSessionService} was
   * supplied to the constructor; without one, the caller must do it.
   *
   * @throws HTTP 404 when the recovery session has expired or does not exist.
   * @throws HTTP 403 when the requested action is not in the session's `grantedActions`.
   */
  async completeRecovery<K extends string = string>(recoverySessionToken: string, action: RecoveryAction): Promise<CompleteRecoveryResult<K>> {
    const session = await this.sessionService.peek(recoverySessionToken);
    if (!session) {
      throw httpError(404).withDetails({ recoverySessionToken: 'not found' });
    }
    if (!session.grantedActions.includes(action.kind)) {
      throw httpError(403).withDetails({ action: `action ${action.kind} not granted for this recovery session` });
    }

    const { actorId } = session.actor;

    switch (action.kind) {
      case 'resetPassword': {
        await this.passwordFactorService.changePassword(actorId, action.newPassword);
        await this.passwordFactorService.clearRateLimit(actorId);
        await this.revokeExistingSessions(actorId, 'resetPassword');
        break;
      }
      case 'unlockAccount': {
        await this.passwordFactorService.clearRateLimit(actorId);
        await this.hooksProvider.hooks.onUnlock?.(actorId);
        break;
      }
      case 'rebindMfaFactor': {
        // Factor mutation is application-specific — fan out to the consuming
        // app's hook. The orchestrator's job ends at authorising the rebind.
        await this.hooksProvider.hooks.onRebindMfaFactor?.({ actorId, method: action.method, methodId: action.methodId });
        break;
      }
      case 'fullRecovery': {
        await this.hooksProvider.hooks.onFullRecovery?.({ actorId, identityProof: action.identityProof });
        await this.revokeExistingSessions(actorId, 'fullRecovery');
        break;
      }
    }

    await this.sessionService.redeem(recoverySessionToken);

    // The terminal event: an out-of-band credential change actually happened.
    await this.audit.record({
      type: 'recovery.completed',
      category: 'credential',
      outcome: 'success',
      actorId,
      data: { action: action.kind },
    });

    return {
      actor: session.actor as TargetActor<K>,
      action,
      performedAt: DateTime.utc(),
    };
  }

  /**
   * Revoke the actor's existing authentication sessions so tokens minted before
   * the recovery stop working. No-ops when no {@link AuthenticationSessionService}
   * was supplied, in which case the caller has to do this itself.
   */
  private async revokeExistingSessions(actorId: string, action: RecoveryActionKind) {
    if (!this.authenticationSessionService) {
      // The optional dependency was never bound, so every pre-recovery token
      // still works. This event is the only way that misconfiguration is visible.
      await this.audit.record({
        type: 'recovery.sessions_not_revoked',
        category: 'privilege',
        outcome: 'success',
        actorId,
        data: { action },
      });
      return;
    }

    const count = await this.authenticationSessionService.revokeAllForSubject(actorId, 'recovery');
    await this.audit.record({
      type: 'recovery.sessions_revoked',
      category: 'privilege',
      outcome: 'success',
      actorId,
      data: { action, count },
    });
  }
}
