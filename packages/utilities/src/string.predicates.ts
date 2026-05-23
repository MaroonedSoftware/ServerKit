/**
 * Returns true when `value` is `undefined`, `null`, or contains only whitespace.
 * Safe to call on nullable values, unlike the `String.prototype.isNullOrUndefinedOrWhitespace`
 * method which throws on `null`/`undefined`.
 */
export const isNullOrUndefinedOrWhitespace = (value: string | null | undefined): boolean => {
  return value === undefined || value === null || value.trim().length === 0;
};

/**
 * Returns true when `value` has at least one non-whitespace character. Safe to call on nullable
 * values, unlike the `String.prototype.hasValue` method which throws on `null`/`undefined`.
 */
export const hasValue = (value: string | null | undefined): boolean => {
  return !isNullOrUndefinedOrWhitespace(value);
};
