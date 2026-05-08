import { Policy } from '@maroonedsoftware/policies';
import { Constructor } from 'injectkit';
import { PhoneAllowedPolicy, PhoneAllowedPolicyContext } from './phone.allowed.policy.js';
import { EmailAllowedPolicy, EmailAllowedPolicyContext } from './email.allowed.policy.js';

/**
 * Names of the policies bundled with this package. Use as the policy-name keys
 * in your `PolicyRegistryMap` (or as a union when extending it).
 */
export type AuthenticationPolicyNames = 'email.allowed' | 'phone.allowed';

/**
 * Default mapping from each bundled {@link AuthenticationPolicyNames} value to
 * its concrete policy class. Convenient for wiring the registry without
 * listing each binding by hand. Spread into your `PolicyRegistryMap` builder,
 * or merge with application-specific mappings before registering.
 */
export const AuthenticationPolicyMappings: Record<AuthenticationPolicyNames, Constructor<Policy>> = {
  'email.allowed': EmailAllowedPolicy,
  'phone.allowed': PhoneAllowedPolicy,
};

/**
 * Mapping from each bundled policy name to its expected context shape. Pass
 * this (or an intersection with your own `Policies` map) as the `TPolicies`
 * type parameter to `BasePolicyService` to get compile-time type safety on
 * `policyService.check('email.allowed', ...)` and friends.
 */
export type AuthenticationPolicyContexts = {
  'email.allowed': EmailAllowedPolicyContext;
  'phone.allowed': PhoneAllowedPolicyContext;
};
