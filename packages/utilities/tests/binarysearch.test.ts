import { describe, it, expect } from 'vitest';
import { binarySearch } from '../src/binarysearch.js';

describe('binarySearch', () => {
  describe('found', () => {
    it('finds a value at the start of the array', () => {
      expect(binarySearch([1, 2, 3, 4, 5], 1)).toBe(true);
    });

    it('finds a value at the end of the array', () => {
      expect(binarySearch([1, 2, 3, 4, 5], 5)).toBe(true);
    });

    it('finds a value in the middle of the array', () => {
      expect(binarySearch([1, 2, 3, 4, 5], 3)).toBe(true);
    });

    it('finds the only element in a single-element array', () => {
      expect(binarySearch([42], 42)).toBe(true);
    });

    it('finds a value in a two-element array (first element)', () => {
      expect(binarySearch([10, 20], 10)).toBe(true);
    });

    it('finds a value in a two-element array (second element)', () => {
      expect(binarySearch([10, 20], 20)).toBe(true);
    });

    it('finds a string value', () => {
      expect(binarySearch(['apple', 'banana', 'cherry'], 'banana')).toBe(true);
    });
  });

  describe('not found', () => {
    it('returns false when the value is below the minimum', () => {
      expect(binarySearch([1, 2, 3, 4, 5], 0)).toBe(false);
    });

    it('returns false when the value is above the maximum', () => {
      expect(binarySearch([1, 2, 3, 4, 5], 6)).toBe(false);
    });

    it('returns false when the value is between two adjacent elements', () => {
      expect(binarySearch([1, 3, 5, 7], 4)).toBe(false);
    });

    it('returns false for an empty array', () => {
      expect(binarySearch([], 1)).toBe(false);
    });

    it('returns false for a single-element array when value does not match', () => {
      expect(binarySearch([42], 99)).toBe(false);
    });

    it('returns false for a string not in the array', () => {
      expect(binarySearch(['apple', 'banana', 'cherry'], 'grape')).toBe(false);
    });
  });
});
