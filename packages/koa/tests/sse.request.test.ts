import { describe, it, expect } from 'vitest';
import { firstQueryValue, resolveLastEventId } from '../src/sse/sse.request.js';

describe('firstQueryValue', () => {
  it('returns a string as-is and the first entry of a list', () => {
    expect(firstQueryValue('a')).toBe('a');
    expect(firstQueryValue(['a', 'b'])).toBe('a');
  });

  it('returns undefined for anything else', () => {
    expect(firstQueryValue(undefined)).toBeUndefined();
    expect(firstQueryValue([])).toBeUndefined();
    expect(firstQueryValue(7)).toBeUndefined();
  });
});

describe('resolveLastEventId', () => {
  it('prefers a positive Last-Event-ID header', () => {
    expect(resolveLastEventId('42', '7')).toBe(42);
  });

  it('falls back to a non-negative query value', () => {
    expect(resolveLastEventId('', '7')).toBe(7);
    expect(resolveLastEventId('0', '7')).toBe(7); // header 0 is not > 0
    expect(resolveLastEventId('', ['9'])).toBe(9);
  });

  it('defaults to 0 when neither is usable', () => {
    expect(resolveLastEventId('', undefined)).toBe(0);
    expect(resolveLastEventId('abc', 'xyz')).toBe(0);
    expect(resolveLastEventId('', '-3')).toBe(0);
  });
});
