import { describe, it, expect } from 'vitest';
import { hasValue, isNullOrUndefinedOrWhitespace } from '../src/string.predicates.js';

describe('isNullOrUndefinedOrWhitespace', () => {
  it('returns true for null and undefined', () => {
    expect(isNullOrUndefinedOrWhitespace(null)).toBe(true);
    expect(isNullOrUndefinedOrWhitespace(undefined)).toBe(true);
  });

  it('returns true for empty and whitespace-only strings', () => {
    expect(isNullOrUndefinedOrWhitespace('')).toBe(true);
    expect(isNullOrUndefinedOrWhitespace('   ')).toBe(true);
    expect(isNullOrUndefinedOrWhitespace('\t\n  ')).toBe(true);
  });

  it('returns false for strings with non-whitespace content', () => {
    expect(isNullOrUndefinedOrWhitespace('a')).toBe(false);
    expect(isNullOrUndefinedOrWhitespace('  hi  ')).toBe(false);
  });
});

describe('hasValue', () => {
  it('returns false for null, undefined, and whitespace-only strings', () => {
    expect(hasValue(null)).toBe(false);
    expect(hasValue(undefined)).toBe(false);
    expect(hasValue('')).toBe(false);
    expect(hasValue('   ')).toBe(false);
  });

  it('returns true for strings with non-whitespace content', () => {
    expect(hasValue('x')).toBe(true);
    expect(hasValue('  hi  ')).toBe(true);
  });
});
