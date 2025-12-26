/**
 * Regular expression pattern for validating UUID strings (versions 0-5).
 * Matches the standard 8-4-4-4-12 hexadecimal format.
 */
const UuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates whether a string is a valid UUID (Universally Unique Identifier).
 * Supports UUID versions 0-5 in the standard 8-4-4-4-12 hexadecimal format.
 *
 * @param value - The string to validate as a UUID.
 * @returns `true` if the string is a valid UUID, `false` otherwise.
 *
 * @example
 * ```typescript
 * isUuid("550e8400-e29b-41d4-a716-446655440000"); // true
 * isUuid("not-a-uuid"); // false
 * ```
 */
export const isUuid = (value: string): boolean => {
  return UuidRegex.test(value);
};
