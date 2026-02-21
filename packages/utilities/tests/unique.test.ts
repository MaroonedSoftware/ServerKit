import { describe, it, expect } from 'vitest';
import { unique } from '../src/unique.js';

describe('unique', () => {
  it('should deduplicate by key selector and keep first occurrence', () => {
    const items = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
      { id: 1, name: 'c' },
      { id: 3, name: 'd' },
      { id: 2, name: 'e' },
    ];
    const result = unique(items, 'id');
    expect(result).toHaveLength(3);
    expect(result.map(r => r.id)).toEqual([1, 2, 3]);
    expect(result[0].name).toBe('a');
    expect(result[1].name).toBe('b');
    expect(result[2].name).toBe('d');
  });

  it('should deduplicate by function selector', () => {
    const items = [
      { id: 1, tag: 'x' },
      { id: 2, tag: 'y' },
      { id: 3, tag: 'x' },
    ];
    const result = unique(items, t => t.tag);
    expect(result).toHaveLength(2);
    expect(result[0].tag).toBe('x');
    expect(result[1].tag).toBe('y');
  });

  it('should return empty array for empty input', () => {
    expect(unique([], 'id')).toEqual([]);
    expect(unique([], () => 1)).toEqual([]);
    expect(unique([])).toEqual([]);
  });

  it('should return copy when all elements are unique', () => {
    const items = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
    ];
    const result = unique(items, 'id');
    expect(result).toHaveLength(2);
    expect(result).toEqual(items);
  });

  it('should preserve first occurrence when duplicates exist', () => {
    const items = [
      { k: 'same', v: 1 },
      { k: 'same', v: 2 },
      { k: 'same', v: 3 },
    ];
    const result = unique(items, 'k');
    expect(result).toHaveLength(1);
    expect(result[0].v).toBe(1);
  });

  it('should work with primitive values via function selector', () => {
    const nums = [1, 2, 1, 3, 2, 4];
    const result = unique(nums, n => n);
    expect(result).toEqual([1, 2, 3, 4]);
  });

  it('should deduplicate by identity when no selector is provided', () => {
    const nums = [1, 2, 1, 3, 2, 4];
    const result = unique(nums);
    expect(result).toEqual([1, 2, 3, 4]);
  });

  it('should deduplicate by reference when no selector and array of objects', () => {
    const obj = { id: 1 };
    const items = [obj, obj, { id: 1 }];
    const result = unique(items);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(obj);
    expect(result[1]).toEqual({ id: 1 });
  });
});
