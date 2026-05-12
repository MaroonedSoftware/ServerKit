import { Injectable } from 'injectkit';
import { Policy, PolicyEnvelope, PolicyResult } from '@maroonedsoftware/policies';
import { OidcProfile } from '../factors/oidc/oidc.factor.service.js';

/**
 * Context for {@link OidcProfileAllowedPolicy}. The verified profile is built
 * from the id_token claims and `/userinfo` response, with the union of both
 * available on `profile.rawClaims` for claim-driven rules (e.g. asserting
 * Google Workspace `hd`).
 */
export interface OidcProfileAllowedPolicyContext {
  /** Verified profile built from id_token claims + userinfo. */
  profile: OidcProfile;
}

/**
 * Policy that gates which verified OIDC profiles are allowed to sign in or
 * link a factor. The default implementation allows every profile; subclass
 * and register your subclass under the policy name `'auth.factor.oidc.profile.allowed'`
 * to enforce Workspace-domain restrictions, sub allowlists, or other
 * provider-specific rules.
 *
 * Invoked by {@link OidcFactorService.completeAuthorization} after the
 * id_token is validated by `openid-client` (so `rawClaims` is trustworthy)
 * and before any factor lookup or creation.
 */
@Injectable()
export class OidcProfileAllowedPolicy extends Policy<OidcProfileAllowedPolicyContext> {
  async evaluate(_context: OidcProfileAllowedPolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    return this.allow();
  }
}
