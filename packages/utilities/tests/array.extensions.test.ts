import { describe, it, expect, vi } from 'vitest';
import '../src/array.extensions.js';

describe('Array.prototype.uniqueBy', () => {
  it('deduplicates by property key, keeping the first occurrence', () => {
    const items = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
      { id: 1, name: 'c' },
    ];
    const result = items.uniqueBy('id');
    expect(result).toHaveLength(2);
    expect(result.map(r => r.name)).toEqual(['a', 'b']);
  });

  it('deduplicates by function selector returning a property value', () => {
    const items = [{ tag: 'x' }, { tag: 'y' }, { tag: 'x' }];
    const result = items.uniqueBy(t => t.tag);
    expect(result.map(r => r.tag)).toEqual(['x', 'y']);
  });

  it('deduplicates by a computed value not present on the element', () => {
    const items = [{ email: 'A@x.com' }, { email: 'a@x.com' }, { email: 'b@x.com' }];
    const result = items.uniqueBy(t => t.email.toLowerCase());
    expect(result.map(r => r.email)).toEqual(['A@x.com', 'b@x.com']);
  });

  it('deduplicates by a composed key', () => {
    const items = [
      { first: 'a', last: 'b' },
      { first: 'a', last: 'b' },
      { first: 'a', last: 'c' },
    ];
    const result = items.uniqueBy(t => `${t.first}|${t.last}`);
    expect(result).toHaveLength(2);
  });

  it('returns an empty array for an empty input', () => {
    expect([].uniqueBy(t => t)).toEqual([]);
  });
});

describe('Array.prototype.cast', () => {
  it('returns the same array typed as the narrower element type', () => {
    const arr: Array<number | string> = [1, 2, 3];
    const cast = arr.cast<number>();
    expect(cast).toBe(arr);
    expect(cast).toEqual([1, 2, 3]);
  });
});

describe('Array.prototype.deleteProperties', () => {
  it('returns a new array of shallow copies with the named properties removed', () => {
    const items = [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ];
    const result = items.deleteProperties('b');
    expect(result).toEqual([{ a: 1 }, { a: 3 }]);
  });

  it('does not mutate the original elements', () => {
    const items = [{ a: 1, b: 2 }];
    items.deleteProperties('b');
    expect(items[0]).toEqual({ a: 1, b: 2 });
  });

  it('does not return the same references', () => {
    const items = [{ a: 1, b: 2 }];
    const result = items.deleteProperties('b');
    expect(result[0]).not.toBe(items[0]);
  });

  it('handles multiple property names', () => {
    const items = [{ a: 1, b: 2, c: 3 }];
    expect(items.deleteProperties('a', 'c')).toEqual([{ b: 2 }]);
  });
});

describe('Array.prototype.intersect', () => {
  it('returns the intersection of primitives without a comparer', () => {
    expect([1, 2, 3, 4].intersect([2, 4, 5])).toEqual([2, 4]);
  });

  it('preserves duplicates from the receiver when no comparer is provided', () => {
    expect([1, 1, 2, 3, 1].intersect([1, 3])).toEqual([1, 1, 3, 1]);
  });

  it('keeps falsy matches when a comparer is provided', () => {
    expect([0, 1, 2].intersect([0, 1, 2], (a, b) => a === b)).toEqual([0, 1, 2]);
    expect(['', 'x'].intersect(['', 'x'], (a, b) => a === b)).toEqual(['', 'x']);
  });

  it('uses the comparer when provided', () => {
    const a = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const b = [{ id: 2 }, { id: 3 }, { id: 4 }];
    const result = a.intersect(b, (x, y) => x.id === y.id);
    expect(result.map(r => r.id)).toEqual([2, 3]);
  });

  it('returns the matching element from `other` when a comparer is provided', () => {
    const a = [{ id: 1, src: 'a' }];
    const b = [{ id: 1, src: 'b' }];
    const result = a.intersect(b, (x, y) => x.id === y.id);
    expect(result[0]!.src).toBe('b');
  });

  it('returns an empty array when there is no overlap', () => {
    expect([1, 2].intersect([3, 4])).toEqual([]);
  });
});

describe('Array.prototype.arrayEquals', () => {
  it('returns true for arrays with the same elements in the same order', () => {
    expect([1, 2, 3].arrayEquals([1, 2, 3])).toBe(true);
  });

  it('returns false for arrays of different lengths', () => {
    expect([1, 2].arrayEquals([1, 2, 3])).toBe(false);
  });

  it('returns false when elements differ at any index', () => {
    expect([1, 2, 3].arrayEquals([1, 9, 3])).toBe(false);
  });

  it('uses strict equality (does not deep-compare)', () => {
    expect([{ a: 1 }].arrayEquals([{ a: 1 }])).toBe(false);
  });

  it('defers to the supplied comparer when provided', () => {
    expect([{ a: 1 }, { a: 2 }].arrayEquals([{ a: 1 }, { a: 2 }], (x, y) => x.a === y.a)).toBe(true);
    expect([{ a: 1 }, { a: 2 }].arrayEquals([{ a: 1 }, { a: 3 }], (x, y) => x.a === y.a)).toBe(false);
  });

  it('returns false for length mismatch even when a comparer is provided', () => {
    const comparer = vi.fn(() => true);
    expect([1, 2].arrayEquals([1, 2, 3], comparer)).toBe(false);
    expect(comparer).not.toHaveBeenCalled();
  });
});

describe('Array.prototype.binarySearch', () => {
  it('returns true when the value is present in a sorted array', () => {
    expect([1, 2, 3, 4, 5].binarySearch(3)).toBe(true);
  });

  it('returns false when the value is absent', () => {
    expect([1, 2, 3, 4, 5].binarySearch(6)).toBe(false);
  });
});

describe('Array.prototype.takeWhile', () => {
  it('returns the prefix where the predicate is true', () => {
    expect([1, 2, 3, 4, 1].takeWhile(n => n < 3)).toEqual([1, 2]);
  });

  it('stops at the first false and does not resume', () => {
    expect([1, 5, 2, 1].takeWhile(n => n < 3)).toEqual([1]);
  });

  it('returns an empty array when the first element fails the predicate', () => {
    expect([5, 1, 2].takeWhile(n => n < 3)).toEqual([]);
  });

  it('passes index and array arguments to the predicate', () => {
    const seenIndexes: number[] = [];
    [10, 20, 30].takeWhile((_v, i, _arr) => {
      seenIndexes.push(i);
      return true;
    });
    expect(seenIndexes).toEqual([0, 1, 2]);
  });
});

describe('Array.prototype.takeWhileAggregate', () => {
  it('accumulates and collects until proceed is false', () => {
    const result = [1, 2, 3, 4, 5].takeWhileAggregate(0, (acc, n) => ({
      newAccumulator: acc + n,
      output: acc + n,
      proceed: acc + n < 6,
    }));
    expect(result).toEqual([1, 3, 6]);
  });

  it('includes the element that triggered the break', () => {
    const result = [10, 20, 30].takeWhileAggregate('', (acc, n) => ({
      newAccumulator: acc + n,
      output: `${n}`,
      proceed: n < 20,
    }));
    expect(result).toEqual(['10', '20']);
  });

  it('returns an empty array when input is empty', () => {
    const result: number[] = [].takeWhileAggregate(0, (acc, n: number) => ({
      newAccumulator: acc + n,
      output: n,
      proceed: true,
    }));
    expect(result).toEqual([]);
  });
});

describe('prototype installs', () => {
  it('marks extension methods as non-enumerable', () => {
    for (const name of ['uniqueBy', 'cast', 'deleteProperties', 'intersect', 'arrayEquals', 'binarySearch', 'takeWhile', 'takeWhileAggregate']) {
      const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, name);
      expect(descriptor?.enumerable, `${name} should be non-enumerable`).toBe(false);
    }
  });

  it('does not leak extension keys into for-in over an array', () => {
    const arr = [1, 2, 3];
    const keys: string[] = [];
    for (const key in arr) keys.push(key);
    expect(keys.sort()).toEqual(['0', '1', '2']);
  });
});
