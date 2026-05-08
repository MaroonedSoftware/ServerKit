import { Container, Identifier, Injectable } from 'injectkit';
import { isPolicyResultDenied, Policy, PolicyContext, PolicyEnvelope, PolicyResult } from './policy.js';
import { httpError } from '@maroonedsoftware/errors';

/**
 * Mapping from policy name to the context shape that policy expects. Pass this
 * as the `TPolicies` type parameter to {@link BasePolicyService} so that
 * `check`/`assert` can enforce the right context type per policy name.
 *
 * @example
 * type AppPolicies = {
 *   'email.allowed': { value: string };
 *   'phone.allowed': { value: string };
 * };
 */
export type Policies<PolicyName extends string = string> = Record<PolicyName, PolicyContext>;

/**
 * Registry mapping policy names (e.g. `'email.allowed'`) to the DI identifier
 * of the {@link Policy} that handles them. Populate via your DI container at
 * bootstrap; {@link BasePolicyService.check} uses it to resolve the policy
 * instance for each call.
 */
@Injectable()
export class PolicyRegistryMap extends Map<string, Identifier<Policy>> {}

/**
 * Abstract DI handle for the policy service. Code that needs to evaluate
 * policies depends on `PolicyService` (not on a concrete subclass) so that
 * applications can swap in their own envelope shape via {@link BasePolicyService}.
 */
@Injectable()
export abstract class PolicyService {
  /**
   * Evaluate the policy registered under `policyName` and return its
   * {@link PolicyResult}. Throws if the policy name is unknown.
   */
  abstract check(policyName: string, context: PolicyContext): Promise<PolicyResult>;

  /**
   * Evaluate the policy registered under `policyName` and throw HTTP 403 with
   * a `policy_violation` payload when denied; return normally on allow.
   */
  abstract assert(policyName: string, context: PolicyContext): Promise<void>;
}

/**
 * Default {@link PolicyService} implementation. Subclass to supply a
 * per-evaluation envelope (typically `{ now: DateTime.utc() }`, optionally
 * extended with the request's authentication session, request id, etc.) and
 * register your subclass against `PolicyService` in your DI container.
 *
 * The `TPolicies` type parameter ties policy names to their expected context
 * shape, giving call sites compile-time type safety for `check`/`assert`.
 */
@Injectable()
export abstract class BasePolicyService<
  TPolicies extends Policies<keyof TPolicies & string>,
  TEnvelope extends PolicyEnvelope = PolicyEnvelope,
> extends PolicyService {
  constructor(
    private readonly container: Container,
    private readonly policyRegistry: PolicyRegistryMap,
  ) {
    super();
  }

  /**
   * Build the per-evaluation envelope passed to every policy. Called once per
   * `check`/`assert` invocation. Implement in your subclass to attach
   * request-scoped state (current session, request id, feature flags, …).
   */
  protected abstract buildEnvelope(): Promise<TEnvelope>;

  /**
   * Resolve the policy registered under `policyName` and evaluate it with the
   * supplied context and a freshly built envelope.
   *
   * @param policyName - A key of `TPolicies` — the registered policy name.
   * @param context    - The context shape declared for `policyName` in `TPolicies`.
   * @returns The {@link PolicyResult} produced by the policy.
   * @throws Error when no policy is registered under `policyName`.
   */
  async check<K extends keyof TPolicies & string>(policyName: K, context: TPolicies[K]): Promise<PolicyResult> {
    const policyIdentifier = this.policyRegistry.get(policyName);

    if (!policyIdentifier) {
      throw new Error(`unknown policy: ${policyName}`);
    }

    const policy = this.container.get<Policy>(policyIdentifier);
    const envelope = await this.buildEnvelope();
    const result = await policy.evaluate(context, envelope);

    return result;
  }

  /**
   * Same as {@link check}, but throws HTTP 403 (with the policy name, reason,
   * and any `details` attached as internal details under
   * `kind: 'policy_violation'`) when the result is denied.
   *
   * @throws HTTP 403 when the policy denies the request.
   * @throws Error when no policy is registered under `policyName`.
   */
  async assert<K extends keyof TPolicies & string>(policyName: K, context: TPolicies[K]): Promise<void> {
    const result = await this.check(policyName, context);
    if (isPolicyResultDenied(result)) {
      throw httpError(403).withInternalDetails({
        message: `policy violation [${policyName}]: ${result.reason}`,
        policyName,
        reason: result.reason,
        kind: 'policy_violation',
        details: result.details,
      });
    }
  }
}
