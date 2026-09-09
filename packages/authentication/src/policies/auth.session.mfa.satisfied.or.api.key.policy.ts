import { Injectable } from 'injectkit';
import { PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { DefaultMfaSatisfiedPolicy, type AuthMfaSatisfiedPolicyContext } from './auth.mfa.satisfied.policy.js';
import { getApiKeyClaim } from './auth.session.api.key.policy.js';

/**
 * Policy name under which {@link MfaSatisfiedOrApiKeyPolicy} is registered.
 */
export const MFA_SATISFIED_OR_API_KEY_POLICY = 'auth.session.mfa.satisfied.or.api.key' as const;

/**
 * Accept either an MFA-satisfied user session or an API key session.
 *
 * The common case for a route that serves a browser and an integration from one
 * path. Without it the two have to be mounted separately, or the MFA gate has to
 * be dropped for both.
 *
 * A key is not a second factor, and this does not pretend otherwise — it says
 * the route accepts machine callers *as well as* MFA-satisfied people. Do not
 * reach for it on a route where the MFA requirement is the actual control, such
 * as changing a password or viewing recovery codes.
 */
@Injectable()
export class MfaSatisfiedOrApiKeyPolicy extends DefaultMfaSatisfiedPolicy {
  override async evaluate(context: AuthMfaSatisfiedPolicyContext, envelope: PolicyEnvelope): Promise<PolicyResult> {
    if (getApiKeyClaim(context.session)) return this.allow();

    return super.evaluate(context, envelope);
  }
}
