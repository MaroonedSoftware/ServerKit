/**
 * A `JSON.stringify` replacer that serializes `bigint` values as strings with a trailing `n`
 * (e.g. `123n` → `"123n"`), since JSON does not natively support `bigint`.
 *
 * Pair with {@link bigIntReviver} to round-trip `bigint` values through JSON.
 *
 * @param _ - The property key (unused).
 * @param value - The value being serialized.
 * @returns The stringified bigint (e.g. `"123n"`) or the original value unchanged.
 *
 * @example
 * ```typescript
 * JSON.stringify({ id: 9007199254740993n }, bigIntReplacer);
 * // '{"id":"9007199254740993n"}'
 * ```
 */
export const bigIntReplacer = (_: string, value: unknown): unknown => {
  if (typeof value === 'bigint') {
    return value.toString() + 'n';
  }
  return value;
};

/**
 * A `JSON.parse` reviver that deserializes strings matching `/^-?\d+n$/` back to native `bigint`
 * (e.g. `"123n"` → `123n`).
 *
 * Pair with {@link bigIntReplacer} to round-trip `bigint` values through JSON.
 *
 * @param _ - The property key (unused).
 * @param value - The value being deserialized.
 * @returns The parsed `bigint` or the original value unchanged.
 *
 * @example
 * ```typescript
 * JSON.parse('{"id":"9007199254740993n"}', bigIntReviver);
 * // { id: 9007199254740993n }
 * ```
 */
export const bigIntReviver = (_: string, value: unknown): unknown => {
  if (typeof value === 'string' && /^-?\d+n$/.test(value)) {
    return BigInt(value.slice(0, -1));
  }
  return value;
};
