/**
 * Joins the truthy strings in `values` with `separator`, filtering out empty strings,
 * `undefined`, and `null` first.
 * @param separator String inserted between non-empty values. Passing `undefined` yields the
 * native `Array.join` default (`','`).
 * @param values Strings to join. Falsy entries are dropped.
 */
export const joinNonEmpty = (separator: string | undefined, ...values: string[]): string => {
  return values.filter(Boolean).join(separator);
};
