import { Injectable } from 'injectkit';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { TargetActor } from '../mfa/types.js';
import { RecoveryChannel, RecoveryEligibleChannel, RecoveryReason } from '../recovery/types.js';

/**
 * Context for {@link RecoveryAllowedPolicy}. Supplied by
 * {@link RecoveryOrchestrator} at each state transition so the policy can gate
 * recovery globally (e.g. an org-wide kill switch) or differentially by
 * scenario, channel, or actor flags.
 */
export interface RecoveryAllowedPolicyContext<K extends string = string> {
  /** Resolved actor when known; `undefined` for an unrecognised identifier (the policy may still allow an anonymous challenge to avoid user enumeration). */
  actor?: TargetActor<K>;
  /** Why the actor is recovering. */
  reason: RecoveryReason;
  /** Channels the orchestrator has computed from the actor's factors. */
  eligibleChannels?: RecoveryEligibleChannel[];
  /** The channel being initiated, when this check happens at issue-time. */
  channel?: RecoveryChannel;
  /** Optional flag set by upstream (e.g. an admin tool) when the actor has been approved for full recovery. */
  recoveryAdminApproved?: boolean;
}

/**
 * Default rule for deciding whether recovery is allowed.
 *
 * - Always allows the initial `initiateRecovery` lookup to proceed so the
 *   orchestrator can return an empty-channels challenge for unknown identifiers
 *   (defends against user enumeration).
 * - For known actors:
 *   - `password_reset`, `mfa_recovery`, `unlock` allow when at least one
 *     eligible channel exists.
 *   - `full_recovery` requires a `recoveryCode` channel OR
 *     `recoveryAdminApproved === true` — falling back to either is
 *     intentionally narrow, since full recovery deactivates other factors.
 *
 * Subclass to layer organisation-wide overrides (recovery disabled, IP allow
 * lists, deny lists, additional admin gating), then re-register under the
 * `'recovery.allowed'` name in your DI container.
 */
@Injectable()
export class RecoveryAllowedPolicy extends Policy<RecoveryAllowedPolicyContext> {
  async evaluate(context: RecoveryAllowedPolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    // Unknown actor: allow the orchestrator to surface an empty-channels challenge
    // without revealing whether the identifier exists.
    if (!context.actor) {
      return this.allow();
    }

    const channels = context.eligibleChannels ?? [];

    if (context.reason === 'full_recovery') {
      const hasRecoveryCode = channels.some(c => c.channel === 'recoveryCode');
      if (!hasRecoveryCode && !context.recoveryAdminApproved) {
        return this.deny('full_recovery_not_authorised');
      }
      return this.allow();
    }

    if (channels.length === 0) {
      return this.deny('no_eligible_channel');
    }

    return this.allow();
  }
}
