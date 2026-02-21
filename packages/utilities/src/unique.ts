/**
 * Returns an array of unique items from `array`, deduplicated by the selector.
 * When multiple items produce the same key, the first occurrence is kept.
 *
 * @param array - Input array to deduplicate.
 * @param selector - Optional. A property key of `T` or a function `(t: T) => unknown`.
 *   When omitted, uses identity (the item itself), so primitives are compared by value
 *   and objects by reference.
 * @returns A new array containing one item per distinct key, in first-seen order.
 *
 * @example
 * // By key
 * unique([{ id: 1, n: 'a' }, { id: 1, n: 'b' }], 'id')
 * // => [{ id: 1, n: 'a' }]
 *
 * @example
 * // By function
 * unique([{ tag: 'x' }, { tag: 'y' }, { tag: 'x' }], t => t.tag)
 * // => [{ tag: 'x' }, { tag: 'y' }]
 *
 * @example
 * // No selector (identity)
 * unique([1, 2, 1, 3])
 * // => [1, 2, 3]
 */
export const unique = <T>(array: T[], selector?: keyof T | ((t: T) => unknown)): T[] => {
  const map = new Map<unknown, T>();

  const _selector: (t: T) => unknown = selector === undefined ? (t: T) => t : typeof selector === 'function' ? selector : (t: T) => t[selector];

  for (const item of array) {
    const key = _selector(item);
    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return Array.from(map.values());
};
