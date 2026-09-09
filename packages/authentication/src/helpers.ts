import crypto from 'node:crypto';
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

/**
 * Mask an email address for display in a pre-authentication channel picker.
 * Keeps the first character of the local part and the full domain, so the
 * holder recognises their own address without the value being usable by
 * someone probing another account.
 *
 * @example
 * ```ts
 * maskEmail('jordan@example.com'); // 'j*****@example.com'
 * ```
 */
export const maskEmail = (value: string): string => {
  const at = value.lastIndexOf('@');
  if (at <= 0) return '*'.repeat(Math.max(value.length, 1));
  const local = value.slice(0, at);
  const domain = value.slice(at);
  if (local.length === 1) return `*${domain}`;
  return `${local[0]}${'*'.repeat(local.length - 1)}${domain}`;
};

/**
 * Mask a phone number for display in a pre-authentication channel picker.
 * Keeps only the last two digits.
 *
 * @example
 * ```ts
 * maskPhone('+12025550123'); // '•••• 23'
 * ```
 */
export const maskPhone = (value: string): string => {
  const digits = value.replace(/\D/g, '');
  if (digits.length <= 2) return '•••• ';
  return `•••• ${digits.slice(-2)}`;
};

/**
 * Compare two secrets in constant time with respect to their contents.
 *
 * Lengths are compared as **bytes**, not characters: `crypto.timingSafeEqual`
 * throws a `RangeError` on unequal buffers, and two strings of equal character
 * length can encode to different byte lengths.
 *
 * A mismatch in length is still detectable by timing, which is inherent to the
 * primitive and not a problem for the fixed-length codes and tokens this package
 * compares.
 *
 * @param a - First value.
 * @param b - Second value.
 * @returns `true` when the two are byte-for-byte equal.
 */
export const timingSafeCompare = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
};
