import { describe, it, expect } from 'vitest';
import { invalidAuthenticationSession } from '../src/types.js';

describe('invalidAuthenticationSession', () => {
  it('has an empty subject', () => {
    expect(invalidAuthenticationSession.subject).toBe('');
  });

  it('has an empty sessionToken', () => {
    expect(invalidAuthenticationSession.sessionToken).toBe('');
  });

  it('has invalid issuedAt', () => {
    expect(invalidAuthenticationSession.issuedAt.isValid).toBe(false);
  });

  it('has invalid lastAccessedAt', () => {
    expect(invalidAuthenticationSession.lastAccessedAt.isValid).toBe(false);
  });

  it('has invalid expiresAt', () => {
    expect(invalidAuthenticationSession.expiresAt.isValid).toBe(false);
  });

  it('has an empty factors array', () => {
    expect(invalidAuthenticationSession.factors).toEqual([]);
  });

  it('has an empty claims object', () => {
    expect(invalidAuthenticationSession.claims).toEqual({});
  });
});
