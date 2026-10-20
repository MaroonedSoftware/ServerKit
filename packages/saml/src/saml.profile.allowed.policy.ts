import { Injectable, type Constructor } from 'injectkit';
import { Policy, type PolicyEnvelope, type PolicyResult } from '@maroonedsoftware/policies';
import type { SamlProfile } from './saml.factor.service.js';

/** Policy name {@link SamlFactorService} consults on every validated assertion. */
export const SAML_PROFILE_ALLOWED_POLICY = 'auth.factor.saml.profile.allowed' as const;

/**
 * Context for {@link SamlProfileAllowedPolicy}. The profile is built from an assertion whose
 * signature, issuer, audience, recipient and validity window have already been checked, so
 * `attributes` is trustworthy.
 */
export interface SamlProfileAllowedPolicyContext {
  /** Profile built from the validated assertion. */
  profile: SamlProfile;
}

/**
 * Policy that gates which validated SAML profiles may sign in or link a factor. The default
 * allows every profile; subclass and register your subclass under
 * {@link SAML_PROFILE_ALLOWED_POLICY} to refuse, for example, an address outside the domains the
 * connection's organization has verified.
 *
 * Invoked by {@link SamlFactorService.completeAuthorization} after the assertion is validated and
 * before any factor lookup or creation.
 */
@Injectable()
export class SamlProfileAllowedPolicy extends Policy<SamlProfileAllowedPolicyContext> {
  async evaluate(_context: SamlProfileAllowedPolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    return this.allow();
  }
}

/** Names of the policies bundled with this package, for a `PolicyRegistryMap`. */
export type SamlPolicyNames = typeof SAML_PROFILE_ALLOWED_POLICY;

/** Default mapping from each bundled policy name to its class. Spread next to `AuthenticationPolicyMappings`. */
export const SamlPolicyMappings: Record<SamlPolicyNames, Constructor<Policy>> = {
  [SAML_PROFILE_ALLOWED_POLICY]: SamlProfileAllowedPolicy,
};

/** Mapping from each bundled policy name to its context, for `BasePolicyService`'s `TPolicies`. */
export type SamlPolicyContexts = {
  [SAML_PROFILE_ALLOWED_POLICY]: SamlProfileAllowedPolicyContext;
};
