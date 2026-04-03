import { describe, it, expect } from 'vitest';
import { nullToUndefined } from '../src/null.to.undefined.js';

describe('nullToUndefined', () => {
  it('should replace null values with undefined', () => {
    const result = nullToUndefined({ a: null, b: null });
    expect(result).toEqual({ a: undefined, b: undefined });
  });

  it('should leave non-null values unchanged', () => {
    const result = nullToUndefined({ a: 1, b: 'hello', c: true });
    expect(result).toEqual({ a: 1, b: 'hello', c: true });
  });

  it('should handle a mix of null and non-null values', () => {
    const result = nullToUndefined({ a: null, b: 42, c: null, d: 'text' });
    expect(result).toEqual({ a: undefined, b: 42, c: undefined, d: 'text' });
  });

  it('should return an empty object for empty input', () => {
    expect(nullToUndefined({})).toEqual({});
  });

  it('should not modify the original object', () => {
    const input = { a: null, b: 1 };
    nullToUndefined(input);
    expect(input).toEqual({ a: null, b: 1 });
  });

  it('should preserve undefined values as undefined', () => {
    const result = nullToUndefined({ a: undefined, b: null });
    expect(result).toEqual({ a: undefined, b: undefined });
  });

  it('should be a shallow transform and not recurse into nested objects', () => {
    const nested = { x: null };
    const result = nullToUndefined<{ a: typeof nested }>({ a: nested });
    expect(result.a).toBe(nested);
    expect(result.a.x).toBe(null);
  });
});
