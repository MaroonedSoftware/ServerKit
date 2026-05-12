import { Injectable } from 'injectkit';
import { Duration } from 'luxon';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { AuthenticationFactorKind, AuthenticationFactorMethod, AuthenticationSessionFactor } from '../types.js';
import { isFactorRecent, matchesFactorConstraints } from '../helpers.js';

/**
 * Context for {@link DefaultRecentFactorPolicy}. The caller supplies the
 * session's `factors` snapshot plus the constraints that define an
 * acceptable proof:
 *
 * - `within` — maximum age of an acceptable factor re-verification.
 * - `anyOfKinds` — when set, only factors whose `kind` is in this list count.
 * - `anyOfMethods` — when set, only factors whose `method` is in this list count.
 * - `excludeMethods` — factors whose `method` is in this list never count.
 *
 * At least one factor must satisfy all set constraints *and* be recent enough
 * for the policy to allow.
 */
export interface AuthRecentFactorPolicyContext {
  /** Authentication factors on the current session, evaluated for recency and match. */
  factors: ReadonlyArray<AuthenticationSessionFactor>;
  /** Maximum age of an acceptable factor re-verification. */
  within: Duration;
  /** If set, only factors whose `kind` is in this list count. */
  anyOfKinds?: ReadonlyArray<AuthenticationFactorKind>;
  /** If set, only factors whose `method` is in this list count. */
  anyOfMethods?: ReadonlyArray<AuthenticationFactorMethod>;
  /** If set, factors whose `method` is in this list never count. */
  excludeMethods?: ReadonlyArray<AuthenticationFactorMethod>;
}

/**
 * Generic step-up rule. Allows when at least one factor in `context.factors`
 * matches the supplied constraints (`anyOfKinds`, `anyOfMethods`,
 * `excludeMethods`) *and* was re-verified within `context.within` of
 * `envelope.now`. Denies with `kind: 'step_up_required'` and an embedded
 * {@link import('@maroonedsoftware/policies').StepUpRequirement StepUpRequirement}
 * otherwise, so clients can drive the user through a re-auth challenge before
 * retrying the gated operation.
 *
 * The policy itself takes no opinion on the actor model — callers extract the
 * `factors` array from their actor or session shape before invoking. Gate on
 * actor kind (e.g. reject non-human actors with a different `reason`) at the
 * call site or in a wrapping subclass.
 *
 * Subclass to layer additional rules on top (org-level overrides, risk
 * scoring, …) and re-register the subclass under the same
 * `'auth.recent.factor'` name in your DI container.
 */
@Injectable()
export class DefaultRecentFactorPolicy extends Policy<AuthRecentFactorPolicyContext> {
  async evaluate(context: AuthRecentFactorPolicyContext, envelope: PolicyEnvelope): Promise<PolicyResult> {
    const matched = context.factors.some(
      factor =>
        matchesFactorConstraints(factor, {
          anyOfKinds: context.anyOfKinds,
          anyOfMethods: context.anyOfMethods,
          excludeMethods: context.excludeMethods,
        }) && isFactorRecent(factor, envelope.now, context.within),
    );

    if (matched) return this.allow();

    return this.denyStepUp('no recent factor satisfies the step-up requirement', {
      within: context.within,
      ...(context.anyOfMethods ? { acceptableMethods: context.anyOfMethods } : {}),
      ...(context.anyOfKinds ? { acceptableKinds: context.anyOfKinds } : {}),
      ...(context.excludeMethods ? { excludeMethods: context.excludeMethods } : {}),
    });
  }
}
