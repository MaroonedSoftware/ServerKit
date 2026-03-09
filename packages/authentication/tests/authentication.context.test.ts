import { describe, it, expect } from 'vitest';
import { invalidAuthenticationContext } from '../src/authentication.context.js';

describe('invalidAuthenticationContext', () => {
  it('has an empty authenticationId', () => {
    expect(invalidAuthenticationContext.authenticationId).toBe('');
  });

  it('has invalid issuedAt', () => {
    expect(invalidAuthenticationContext.issuedAt.isValid).toBe(false);
  });

  it('has invalid lastAccessedAt', () => {
    expect(invalidAuthenticationContext.lastAccessedAt.isValid).toBe(false);
  });

  it('has invalid expiresAt', () => {
    expect(invalidAuthenticationContext.expiresAt.isValid).toBe(false);
  });

  it('has an empty factors array', () => {
    expect(invalidAuthenticationContext.factors).toEqual([]);
  });

  it('has an empty claims object', () => {
    expect(invalidAuthenticationContext.claims).toEqual({});
  });
});
