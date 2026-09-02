import { describe, it, expect } from 'vitest';
import { createAnonymousPathMatcher } from '../src/authentication/anonymous.paths.js';

describe('createAnonymousPathMatcher', () => {
  it('matches nothing by default', () => {
    expect(createAnonymousPathMatcher()('/health')).toBe(false);
  });

  it('matches exact string paths only', () => {
    const isAnonymous = createAnonymousPathMatcher(['/health']);

    expect(isAnonymous('/health')).toBe(true);
    expect(isAnonymous('/health/')).toBe(false);
    expect(isAnonymous('/healthz')).toBe(false);
    expect(isAnonymous('/Health')).toBe(false);
  });

  it('matches RegExp patterns', () => {
    const isAnonymous = createAnonymousPathMatcher([/^\/public\//]);

    expect(isAnonymous('/public/logo.png')).toBe(true);
    expect(isAnonymous('/private/logo.png')).toBe(false);
  });

  it('combines strings and patterns', () => {
    const isAnonymous = createAnonymousPathMatcher(['/health', /^\/public\//]);

    expect(isAnonymous('/health')).toBe(true);
    expect(isAnonymous('/public/x')).toBe(true);
    expect(isAnonymous('/api')).toBe(false);
  });
});
