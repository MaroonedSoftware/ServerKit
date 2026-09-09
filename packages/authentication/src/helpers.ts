import crypto from 'node:crypto';
import { type AuthenticationFactorKind, type AuthenticationFactorMethod, type AuthenticationSessionFactor, type SessionDevice } from './types.js';
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

/**
 * Longest `User-Agent` this package stores on a session.
 *
 * The header is attacker-controlled and unbounded, so it is clamped rather than
 * stored as given. 512 is what both ServerKit consumers already clamp to and
 * what their wire contracts already declare, so nothing downstream has to move.
 */
export const MAX_USER_AGENT_LENGTH = 512;

/** Trim a value, treating blank as absent. */
const presentOrUndefined = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

/**
 * Clean up a {@link SessionDevice} before it is stored.
 *
 * Trims each field, drops blanks, and clamps the user agent to
 * {@link MAX_USER_AGENT_LENGTH}.
 *
 * **Blank handling is the part that matters.** Both HTTP adapters set
 * `userAgent` to `''` when the header is absent — Koa's `ctx.get` returns an
 * empty string for a missing header, and the Fastify plugin defaults it
 * explicitly — so without this every session created through them would record
 * an empty user agent rather than no user agent, and a session list would show
 * a blank column instead of nothing.
 *
 * @param device - The raw values, as the application read them off the request.
 * @returns The cleaned block, or `undefined` when nothing survives, so an empty
 *   object is never stored.
 */
export const normaliseSessionDevice = (device: SessionDevice | undefined): SessionDevice | undefined => {
  if (!device) return undefined;

  const ipAddress = presentOrUndefined(device.ipAddress);
  const userAgent = presentOrUndefined(device.userAgent)?.slice(0, MAX_USER_AGENT_LENGTH);
  const label = presentOrUndefined(device.label);

  if (!ipAddress && !userAgent && !label) return undefined;

  return {
    ...(ipAddress === undefined ? {} : { ipAddress }),
    ...(userAgent === undefined ? {} : { userAgent }),
    ...(label === undefined ? {} : { label }),
  };
};
