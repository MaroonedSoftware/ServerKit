import { type AuthenticationFactorKind, type AuthenticationFactorMethod, type AuthenticationSessionFactor } from './types.js';
import { DateTime, Duration } from 'luxon';

/**
 * Test whether `factor` satisfies the supplied constraint set. Useful for
 * step-up policies that need to find at least one session factor matching a
 * `StepUpRequirement`.
 *
 * Constraint semantics (each is independent; all that are set must hold):
 * - `excludeMethods` — factor's `method` must not be in this list.
 * - `anyOfMethods`   — factor's `method` must be in this list (when set).
 * - `anyOfKinds`     — factor's `kind` must be in this list (when set).
 *
 * An empty constraint set matches every factor.
 */
export const matchesFactorConstraints = (
  factor: AuthenticationSessionFactor,
  constraints: {
    anyOfKinds?: ReadonlyArray<AuthenticationFactorKind>;
    anyOfMethods?: ReadonlyArray<AuthenticationFactorMethod>;
    excludeMethods?: ReadonlyArray<AuthenticationFactorMethod>;
  },
): boolean => {
  if (constraints.excludeMethods?.includes(factor.method)) return false;
  if (constraints.anyOfMethods && !constraints.anyOfMethods.includes(factor.method)) return false;
  if (constraints.anyOfKinds && !constraints.anyOfKinds.includes(factor.kind)) return false;
  return true;
};

/**
 * Test whether `factor` was re-verified within `within` of `now`. Used by
 * step-up policies to enforce a maximum age on acceptable proof — e.g. require
 * a re-auth in the last five minutes before a sensitive operation.
 */
export const isFactorRecent = (factor: AuthenticationSessionFactor, now: DateTime, within: Duration): boolean => {
  const threshold = now.minus(within);
  return factor.authenticatedAt >= threshold;
};
