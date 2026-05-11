import { Injectable } from 'injectkit';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { OAuth2Profile } from '../providers/oauth2.provider.js';

/**
 * Context for {@link OAuth2ProfileAllowedPolicy}. `profile.rawProfile`
 * preserves the provider-specific payload from `fetchProfile` so subclasses
 * can branch on provider-specific fields (e.g. GitHub's `two_factor_authentication`).
 */
export interface OAuth2ProfileAllowedPolicyContext {
  /** Profile returned by the provider's `fetchProfile` adapter. */
  profile: OAuth2Profile;
}

/**
 * Policy that gates which OAuth 2.0 profiles are allowed to sign in or link
 * a factor. The default implementation allows every profile; subclass and
 * register your subclass under the policy name `'oauth2.profile.allowed'`
 * to enforce organisation membership, MFA-required rules, or provider-
 * specific restrictions.
 *
 * Invoked by {@link OAuth2FactorService.completeAuthorization} after the
 * provider's `/userinfo`-equivalent has returned, and before any factor
 * lookup or creation.
 */
@Injectable()
export class OAuth2ProfileAllowedPolicy extends Policy<OAuth2ProfileAllowedPolicyContext> {
  async evaluate(_context: OAuth2ProfileAllowedPolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    return this.allow();
  }
}
