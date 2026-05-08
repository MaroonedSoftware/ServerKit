import { Injectable } from 'injectkit';
import { DateTime, Duration } from 'luxon';

/**
 * Result of a successful policy evaluation. Returned by {@link Policy.allow}.
 */
export type PolicyResultAllowed = { allowed: true };

/**
 * Result of a denied policy evaluation. Carries a machine-readable `reason` that
 * callers can branch on to render a user-facing message, plus optional structured
 * `details` (e.g. step-up requirements via {@link Policy.denyStepUp}).
 */
export type PolicyResultDenied = { allowed: false; reason: string; details?: Record<string, unknown> };

/**
 * Discriminated union returned by every {@link Policy.evaluate} call. Branch on
 * `allowed` (or use the {@link isPolicyResultAllowed} / {@link isPolicyResultDenied}
 * type guards) to handle each case.
 */
export type PolicyResult = PolicyResultAllowed | PolicyResultDenied;

/**
 * Type guard for the allowed branch of {@link PolicyResult}.
 */
export const isPolicyResultAllowed = (result: PolicyResult): result is PolicyResultAllowed => result.allowed;

/**
 * Type guard for the denied branch of {@link PolicyResult}.
 */
export const isPolicyResultDenied = (result: PolicyResult): result is PolicyResultDenied => !result.allowed;

/**
 * Per-evaluation context shared across all policies in a single
 * {@link PolicyService.check} call. Built fresh on each evaluation by
 * `BasePolicyService.buildEnvelope` so that policies can reason about
 * "now" consistently regardless of when they happen to run.
 */
export interface PolicyEnvelope {
  /** The wall-clock time at which this evaluation started. */
  now: DateTime;
}

/**
 * Marker type for the per-policy context object. Define a concrete shape
 * (`{ value: string }`, `{ session: AuthenticationSession }`, …) and pass it
 * as the type parameter to {@link Policy}.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface
export interface PolicyContext {}

/**
 * Acceptable proof for satisfying a step-up policy. At least one factor on
 * the session must match the constraints below and have been re-verified
 * within `within` of `now` for the gated operation to proceed.
 */
export interface StepUpRequirement {
  /** Maximum age of an acceptable factor re-verification. */
  within: Duration;
  /** If set, only factors whose `method` is in this list count. */
  acceptableMethods?: ReadonlyArray<string>;
  /** If set, only factors whose `kind` is in this list count. */
  acceptableKinds?: ReadonlyArray<string>;
  /** If set, factors whose `method` is in this list never count. */
  excludeMethods?: ReadonlyArray<string>;
}

/**
 * Base class for an injectable policy. Subclass and implement {@link evaluate}
 * to encode a single allow/deny rule, then register it under a stable name in
 * the `PolicyRegistryMap` so callers can invoke it via
 * {@link PolicyService.check} without depending on the concrete class.
 *
 * The `Context` and `Envelope` type parameters let subclasses declare exactly
 * what input they need; `BasePolicyService.check` enforces the right shape per
 * policy name via its `Policies` map.
 */
@Injectable()
export abstract class Policy<Context extends PolicyContext = PolicyContext, Envelope extends PolicyEnvelope = PolicyEnvelope> {
  /**
   * Evaluate the policy and return an allow or deny result. Implementations
   * should return one of {@link allow}, {@link deny}, or {@link denyStepUp};
   * never throw to signal denial.
   */
  abstract evaluate(context: Context, envelope: Envelope): Promise<PolicyResult>;

  /**
   * Build a denial result with a machine-readable `reason` (e.g. `'deny_list'`,
   * `'invalid_format'`) and optional structured `details`. Callers branch on
   * `reason` to render user-facing messages.
   */
  protected deny(reason: string, details?: Record<string, unknown>): PolicyResultDenied {
    return { allowed: false, reason, details };
  }

  /**
   * Step-up denial helper: bundles a {@link StepUpRequirement} into the
   * response under `kind: 'step_up_required'` + `stepUp: { ... }` so clients
   * can programmatically drive the user through a re-auth challenge before
   * retrying the gated operation.
   */
  protected denyStepUp(reason: string, requirement: StepUpRequirement): PolicyResultDenied {
    return this.deny(reason, { kind: 'step_up_required', stepUp: requirement });
  }

  /**
   * Build an allow result.
   */
  protected allow(): PolicyResultAllowed {
    return { allowed: true };
  }
}
