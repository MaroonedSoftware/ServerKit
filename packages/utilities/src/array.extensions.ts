import { binarySearch } from './binarysearch.js';

type Comparer<T> = (value: T, value2: T) => boolean;

type TakeWhileAggregateFunRetVal<TAccumulate, TDest> = { newAccumulator: TAccumulate; output: TDest; proceed: boolean };

declare global {
  interface Array<T> {
    /**
     * Returns true if `value` is present in this **sorted** array. Delegates to {@link binarySearch};
     * passing an unsorted array produces undefined results.
     */
    binarySearch(value: T): boolean;

    /**
     * Type-casts the array to a narrower element type `U extends T` without copying.
     * The cast is unchecked — the caller is responsible for the invariant.
     */
    cast<U extends T>(): Array<U>;

    /**
     * Returns true if `other` has the same length and every element matches at the same index.
     * Without a comparer, elements are compared with strict equality (`===`) — no deep compare.
     * With a comparer, defers element equality to the supplied function.
     * @param other The array to compare against.
     * @param comparer Optional equality function. When omitted, uses `===`.
     */
    compare(other: Array<T>, comparer?: Comparer<T>): boolean;

    /**
     * Mutates each element by deleting the named properties in place, and returns the same
     * array with the `Omit<T, K>` element type.
     * @param properties Property keys to remove from every element.
     */
    deleteProperties<K extends keyof T>(...properties: K[]): Array<Omit<T, K>>;

    /**
     * Returns the intersection with `other`. Without a comparer, uses `Set` membership
     * (reference equality for objects, value equality for primitives). With a comparer,
     * runs a quadratic find for each element and pushes the matching value from `other`.
     * @param other The array to intersect with.
     * @param comparer Optional equality function.
     */
    intersect(other: Array<T>, comparer?: Comparer<T>): Array<T>;

    /**
     * Like `filter`, but stops at the first element for which the predicate returns false.
     * @param predicate Predicate evaluated against each element until it returns false.
     */
    takeWhile(predicate: (value: T, index: number, array: Array<T>) => boolean): Array<T>;

    /**
     * A combination of `map` and `reduce` with a break condition. Walks the array, threading an
     * accumulator through `step` and collecting `output` values into the result. Stops as soon as
     * `step` returns `proceed: false` (the final element's output is still included).
     * @param seed Initial accumulator value.
     * @param step Step function returning the next accumulator, the output to collect, and whether to continue.
     * @throws Error if the array or `step` is null/undefined.
     */
    takeWhileAggregate<TAccumulate, TDest>(
      seed: TAccumulate,
      step: (accumulator: TAccumulate, element: T) => TakeWhileAggregateFunRetVal<TAccumulate, TDest>,
    ): Array<TDest>;

    /**
     * Returns an array of unique items, deduplicated by the selector. When multiple items
     * produce the same key, the first occurrence is kept.
     * @param selector A property key of `T` or a function `(t: T) => T[K]` used to compute the dedup key.
     */
    unique<K extends keyof T>(selector: K | ((t: T) => T[K])): Array<T>;
  }
}

if (!Array.prototype.binarySearch) {
  Array.prototype.binarySearch = function <T>(this: Array<T>, value: T): boolean {
    return binarySearch(this, value);
  };
}

if (!Array.prototype.cast) {
  Array.prototype.cast = function <T, U extends T>(this: T[]): Array<U> {
    return this as Array<U>;
  };
}

if (!Array.prototype.compare) {
  Array.prototype.compare = function <T>(this: Array<T>, other: Array<T>, comparer?: Comparer<T>): boolean {
    if (this.length !== other.length) return false;
    return comparer ? this.every((item, idx) => comparer(item, other[idx] as T)) : this.every((item, idx) => item === other[idx]);
  };
}

if (!Array.prototype.deleteProperties) {
  Array.prototype.deleteProperties = function <T, K extends keyof T>(this: T[], ...properties: K[]): Array<Omit<T, K>> {
    this.forEach(x => {
      properties.forEach(prop => delete x[prop]);
    });

    return this as Array<Omit<T, K>>;
  };
}

if (!Array.prototype.intersect) {
  Array.prototype.intersect = function <T>(this: Array<T>, other: Array<T>, comparer?: Comparer<T>): Array<T> {
    if (comparer === undefined) {
      const setA = new Set(this);
      const setB = new Set(other);
      return [...setA].filter(value => setB.has(value));
    }
    const interesection: T[] = [];
    this.forEach(value => {
      const found = other.find(value2 => comparer(value, value2));
      if (found) interesection.push(found);
    });
    return interesection;
  };
}

if (!Array.prototype.takeWhile) {
  Array.prototype.takeWhile = function <T>(this: Array<T>, predicate: (value: T, index: number, array: Array<T>) => boolean): Array<T> {
    const result: T[] = [];

    for (let i = 0; i < this.length; i++) {
      const element = this[i] as T;
      if (predicate(element, i, this)) {
        result.push(element);
      } else {
        break;
      }
    }

    return result;
  };
}

// Adapted from a C# Enumerable extension derived from a Reactive Extensions operator.
if (!Array.prototype.takeWhileAggregate) {
  Array.prototype.takeWhileAggregate = function <T, TAccumulate, TDest>(
    this: Array<T>,
    seed: TAccumulate,
    step: (accumulator: TAccumulate, element: T) => TakeWhileAggregateFunRetVal<TAccumulate, TDest>,
  ): Array<TDest> {
    if (!this) {
      throw new Error('Source array is null or undefined');
    }
    if (!step) {
      throw new Error('Function is null or undefined');
    }

    const result: TDest[] = [];
    let accumulator = seed;

    for (let i = 0; i < this.length; i++) {
      const element = this[i] as T;
      const { newAccumulator, output, proceed } = step(accumulator, element);

      accumulator = newAccumulator;
      result.push(output);
      if (!proceed) break;
    }

    return result;
  };
}

if (!Array.prototype.unique) {
  Array.prototype.unique = function <T, K extends keyof T>(this: T[], selector: K | ((t: T) => T[K])): Array<T> {
    const map = new Map<T[K], T>();

    const _selector = typeof selector !== 'function' ? (t: T) => t[selector] : selector;

    this.forEach(a => {
      const key = _selector(a);
      if (!map.has(key)) map.set(key, a);
    });

    return Array.from(map.values());
  };
}

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
