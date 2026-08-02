import { Policy, PolicyContext, PolicyEnvelope, PolicyResult } from './policy.js';
import { Injectable } from 'injectkit';

/**
 * Policy that denies every request with the reason `'always_deny'`.
 *
 * The counterpart to {@link AlwaysAllowPolicy}: bind it to a policy name in the
 * `PolicyRegistryMap` to force the denial branch of every call site that
 * resolves that name, which is the cheapest way to exercise a `403` path
 * end-to-end.
 *
 * The denial carries no `details`, `internalDetails`, or `headers`. That is
 * exact for `assert`-based call sites (they render a `403` with the reason in
 * `internalDetails`), but lossy for callers that read the denial payload to
 * decide what to do next — for example an MFA orchestrator reading
 * `details.eligibleFactors` will fall back to an empty list and issue an
 * unsatisfiable challenge rather than failing outright. Use a purpose-built
 * stub policy when a call site depends on the shape of the denial.
 *
 * @example
 * ```ts
 * map.set('auth.factor.email.allowed', AlwaysDenyPolicy);
 * await expect(service.assert('auth.factor.email.allowed', { value })).rejects.toMatchObject({ statusCode: 403 });
 * ```
 */
@Injectable()
export class AlwaysDenyPolicy extends Policy<PolicyContext, PolicyEnvelope> {
  /**
   * Always resolves to a denial with `reason: 'always_deny'` and no attached
   * payloads. Both the context and the envelope are ignored.
   */
  async evaluate(_context: PolicyContext, _envelope: PolicyEnvelope): Promise<PolicyResult> {
    return this.deny('always_deny');
  }
}
