import { describe, it, expect } from 'vitest';
import { createOriginMatcher, normalizeCorsOrigins } from '../src/cors/cors.origin.js';

describe('normalizeCorsOrigins', () => {
  it('defaults to the wildcard', () => {
    expect(normalizeCorsOrigins(undefined)).toEqual(['*']);
  });

  it('wraps a single string so it is not iterated character-by-character', () => {
    expect(normalizeCorsOrigins('https://a.com')).toEqual(['https://a.com']);
  });

  it('passes a list through', () => {
    const list = ['https://a.com', /b\.com$/];
    expect(normalizeCorsOrigins(list)).toBe(list);
  });
});

describe('createOriginMatcher', () => {
  it('reflects any origin for the wildcard', () => {
    expect(createOriginMatcher(['*'])('https://anything.example')).toBe('https://anything.example');
  });

  it('reflects an exact string match', () => {
    const match = createOriginMatcher(['https://a.com', 'https://b.com']);
    expect(match('https://b.com')).toBe('https://b.com');
  });

  it('reflects a RegExp match', () => {
    const match = createOriginMatcher([/^https:\/\/.*\.example\.com$/]);
    expect(match('https://app.example.com')).toBe('https://app.example.com');
  });

  it('returns the empty string when nothing matches', () => {
    const match = createOriginMatcher(['https://a.com', /^https:\/\/b\.com$/]);
    expect(match('https://evil.com')).toBe('');
  });

  it('falls through string misses to a later RegExp', () => {
    const match = createOriginMatcher(['https://a.com', /^https:\/\/b\.com$/, 'https://c.com']);
    expect(match('https://b.com')).toBe('https://b.com');
    expect(match('https://c.com')).toBe('https://c.com');
  });
});
