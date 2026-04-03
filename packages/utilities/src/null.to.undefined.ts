/**
 * Performs a shallow replacement of all `null` values in an object with `undefined`.
 * Non-null values are passed through unchanged. Nested objects are not traversed.
 *
 * @param obj - The source object to transform.
 * @returns A new object with the same keys, where every `null` value is replaced by `undefined`.
 *
 * @example
 * ```typescript
 * nullToUndefined({ a: null, b: 1, c: null });
 * // { a: undefined, b: 1, c: undefined }
 * ```
 */
export const nullToUndefined = <T = object>(obj: object): T => {
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v === null ? undefined : v])) as T;
};
