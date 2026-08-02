import { Policy, PolicyContext, PolicyEnvelope, PolicyResult } from './policy.js';
import { Injectable } from 'injectkit';

/**
 * Policy that allows every request, regardless of context.
 *
 * Intended for tests and local development, where binding it to a policy name
 * in the `PolicyRegistryMap` neutralises the real policy for every call site
 * that resolves that name through {@link PolicyService.check} / `assert` —
 * without touching the code under test.
 *
 * Note that "allow" is not universally the permissive direction: for a policy
 * such as `'auth.session.mfa.required'` a denial means *MFA is required*, so
 * always-allow skips the challenge; but for `'auth.session.mfa.satisfied'` an
 * allow asserts the session has *already* stepped up. Check which way the
 * policy you are overriding reads before swapping it in, and gate the binding
 * behind a flag that cannot be set in production.
 *
 * @example
 * ```ts
 * registry.register(AlwaysAllowPolicy).useClass(AlwaysAllowPolicy).asSingleton();
 * registry.register(PolicyRegistryMap).useFactory(() => {
 *   const map = new PolicyRegistryMap();
 *   map.set('auth.session.mfa.required', DefaultMfaRequiredPolicy);
 *   if (testBypassEnabled) map.set('auth.session.mfa.required', AlwaysAllowPolicy);
 *   return map;
 * });
 * ```
 */
@Injectable()
export class AlwaysAllowPolicy extends Policy<PolicyContext, PolicyEnvelope> {
  /**
   * Always resolves to `{ allowed: true }`. Both the context and the envelope
   * are ignored.
   */
  async evaluate(_context: PolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    return this.allow();
  }
}
