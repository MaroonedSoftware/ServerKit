import { z } from 'zod';

/**
 * Zod schema that accepts a string ending with "n" (e.g. "100n") and transforms it to a native bigint.
 * Use this instead of z.bigint() for JSON request/response schemas, since JSON cannot represent bigint natively.
 */
export const zBigint = () =>
  z
    .string()
    .regex(/^-?\d+n$/, 'Expected a bigint string (e.g. "100n")')
    .transform(val => BigInt(val.slice(0, -1)));
