import { Policy } from '@maroonedsoftware/policies';
import { Constructor } from 'injectkit';
import { PhoneAllowedPolicy, PhoneAllowedPolicyContext } from './phone.allowed.policy.js';
import { EmailAllowedPolicy, EmailAllowedPolicyContext } from './email.allowed.policy.js';
import { OidcProfileAllowedPolicy, OidcProfileAllowedPolicyContext } from './oidc.profile.allowed.policy.js';
import { OAuth2ProfileAllowedPolicy, OAuth2ProfileAllowedPolicyContext } from './oauth2.profile.allowed.policy.js';
import { PasswordAllowedPolicy, PasswordAllowedPolicyContext } from './password.allowed.policy.js';
import { AuthMfaRequiredPolicyContext, DefaultMfaRequiredPolicy } from './auth.mfa.required.policy.js';
import { AuthMfaSatisfiedPolicyContext, DefaultMfaSatisfiedPolicy } from './auth.mfa.satisfied.policy.js';
import { AuthRecentFactorPolicyContext, DefaultRecentFactorPolicy } from './auth.recent.factor.policy.js';
import { AuthAssuranceLevelPolicyContext, DefaultAssuranceLevelPolicy } from './auth.assurance.level.policy.js';
import { RecoveryAllowedPolicy, RecoveryAllowedPolicyContext } from './recovery.allowed.policy.js';
import { SupportVerificationAllowedPolicy, SupportVerificationAllowedPolicyContext } from './support.verification.allowed.policy.js';

/**
 * Names of the policies bundled with this package. Use as the policy-name keys
 * in your `PolicyRegistryMap` (or as a union when extending it).
 */
export type AuthenticationPolicyNames =
  | 'auth.factor.email.allowed'
  | 'auth.factor.phone.allowed'
  | 'auth.factor.password.allowed'
  | 'auth.factor.oidc.profile.allowed'
  | 'auth.factor.oauth2.profile.allowed'
  | 'auth.session.mfa.required'
  | 'auth.session.mfa.satisfied'
  | 'auth.session.recent.factor'
  | 'auth.session.assurance.level'
  | 'auth.recovery.allowed'
  | 'auth.support.verification.allowed';

/**
 * Default mapping from each bundled {@link AuthenticationPolicyNames} value to
 * its concrete policy class. Convenient for wiring the registry without
 * listing each binding by hand. Spread into your `PolicyRegistryMap` builder,
 * or merge with application-specific mappings before registering.
 */
export const AuthenticationPolicyMappings: Record<AuthenticationPolicyNames, Constructor<Policy>> = {
  'auth.factor.email.allowed': EmailAllowedPolicy,
  'auth.factor.phone.allowed': PhoneAllowedPolicy,
  'auth.factor.password.allowed': PasswordAllowedPolicy,
  'auth.factor.oidc.profile.allowed': OidcProfileAllowedPolicy,
  'auth.factor.oauth2.profile.allowed': OAuth2ProfileAllowedPolicy,
  'auth.session.mfa.required': DefaultMfaRequiredPolicy,
  'auth.session.mfa.satisfied': DefaultMfaSatisfiedPolicy,
  'auth.session.recent.factor': DefaultRecentFactorPolicy,
  'auth.session.assurance.level': DefaultAssuranceLevelPolicy,
  'auth.recovery.allowed': RecoveryAllowedPolicy,
  'auth.support.verification.allowed': SupportVerificationAllowedPolicy,
};

/**
 * Mapping from each bundled policy name to its expected context shape. Pass
 * this (or an intersection with your own `Policies` map) as the `TPolicies`
 * type parameter to `BasePolicyService` to get compile-time type safety on
 * `policyService.check('auth.factor.email.allowed', ...)` and friends.
 */
export type AuthenticationPolicyContexts = {
  'auth.factor.email.allowed': EmailAllowedPolicyContext;
  'auth.factor.phone.allowed': PhoneAllowedPolicyContext;
  'auth.factor.password.allowed': PasswordAllowedPolicyContext;
  'auth.factor.oidc.profile.allowed': OidcProfileAllowedPolicyContext;
  'auth.factor.oauth2.profile.allowed': OAuth2ProfileAllowedPolicyContext;
  'auth.session.mfa.required': AuthMfaRequiredPolicyContext;
  'auth.session.mfa.satisfied': AuthMfaSatisfiedPolicyContext;
  'auth.session.recent.factor': AuthRecentFactorPolicyContext;
  'auth.session.assurance.level': AuthAssuranceLevelPolicyContext;
  'auth.recovery.allowed': RecoveryAllowedPolicyContext;
  'auth.support.verification.allowed': SupportVerificationAllowedPolicyContext;
};
