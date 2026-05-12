import { Injectable } from 'injectkit';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { TargetActor } from '../mfa/types.js';

/**
 * Context for {@link SupportVerificationAllowedPolicy}. Supplied by
 * {@link import('../support/support.verification.code.service.js').SupportVerificationCodeService}
 * at every issue and verify so the policy can gate the support-verification
 * surface globally (e.g. an org-wide kill switch) or differentially per actor.
 */
export interface SupportVerificationAllowedPolicyContext<K extends string = string> {
  /** The actor the code is being issued for or verified against. */
  actor?: TargetActor<K>;
  /** Which side of the flow is being evaluated. */
  operation: 'issue' | 'verify';
}

/**
 * Default rule for deciding whether the support-verification code surface is
 * available for an actor.
 *
 * - Denies when `actor` is missing (the caller hasn't authenticated yet).
 * - Allows otherwise — issuing or verifying a code is treated as a normal
 *   authenticated operation by default.
 *
 * Subclass to layer organisation-wide overrides (feature flag off, tenant
 * disablement, agent-tool IP allow-lists), then re-register under the
 * `'support.verification.allowed'` name in your DI container.
 */
@Injectable()
export class SupportVerificationAllowedPolicy extends Policy<SupportVerificationAllowedPolicyContext> {
  async evaluate(context: SupportVerificationAllowedPolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    if (!context.actor) {
      return this.deny('actor_unknown');
    }
    return this.allow();
  }
}
