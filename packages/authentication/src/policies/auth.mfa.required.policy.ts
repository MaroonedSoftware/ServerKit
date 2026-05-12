import { Injectable } from 'injectkit';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { AuthenticationFactorKind, AuthenticationSessionFactor } from '../types.js';
import { MfaEligibleFactor, TargetActor } from '../mfa/types.js';

/**
 * An {@link MfaEligibleFactor} annotated with its factor `kind`, so the
 * policy can apply kind-based filtering without needing a callback into the
 * factor services.
 */
export interface AuthMfaRequiredPolicyFactor extends MfaEligibleFactor {
  /** The MFA category for this factor (`'knowledge'`, `'possession'`, …). */
  kind: AuthenticationFactorKind;
}

/**
 * Context for {@link DefaultMfaRequiredPolicy}: the actor that just satisfied
 * the primary factor, the factor they used, and every factor they have on
 * file that *could* complete an MFA challenge.
 */
export interface AuthMfaRequiredPolicyContext {
  /** The actor attempting to authenticate. */
  actor: TargetActor;
  /** The primary factor that has just been satisfied. */
  primaryFactor: AuthenticationSessionFactor;
  /** Every factor the actor has on file. The policy decides which qualify as a viable second factor. */
  availableFactors: AuthMfaRequiredPolicyFactor[];
}

/**
 * Default rule for deciding whether MFA is required after a primary factor.
 *
 * Filters `availableFactors` to those that qualify as a viable *second* factor —
 * meaning `kind !== 'knowledge'` (a second password doesn't add MFA value) and
 * `method !== 'oidc' && method !== 'email'` (both fall back to out-of-band
 * proof-of-possession the user has likely already used elsewhere).
 *
 * If any factor survives the filter, MFA is required and the surviving factors
 * are attached to the deny result under `details.eligibleFactors` for the
 * orchestrator to stash on the issued challenge. If nothing survives — e.g. an
 * actor whose only factor is a password — MFA is skipped.
 *
 * Subclass to layer additional rules on top (risk scoring, organization-level
 * overrides, region-specific requirements, …) without touching the
 * orchestrator. Re-register the subclass under the same `'auth.mfa.required'`
 * name in your DI container.
 */
@Injectable()
export class DefaultMfaRequiredPolicy extends Policy<AuthMfaRequiredPolicyContext> {
  async evaluate(context: AuthMfaRequiredPolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    const eligibleFactors: MfaEligibleFactor[] = context.availableFactors
      .filter(factor => factor.kind !== 'knowledge' && factor.method !== 'oidc' && factor.method !== 'email')
      .map(({ method, methodId }) => ({ method, methodId }));

    if (eligibleFactors.length === 0) {
      return this.allow();
    }

    return this.deny('mfa_required', { eligibleFactors });
  }
}
