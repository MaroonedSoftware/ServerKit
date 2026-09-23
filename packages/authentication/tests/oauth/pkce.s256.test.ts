import { describe, expect, it } from 'vitest';
import { isPkceS256Challenge, verifyPkceS256 } from '../../src/oauth/pkce.s256.js';

// RFC 7636 Appendix B.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('verifyPkceS256', () => {
  it('accepts the RFC 7636 Appendix B vector', () => {
    expect(verifyPkceS256(VERIFIER, CHALLENGE)).toBe(true);
  });

  it('refuses a verifier that hashes to something else', () => {
    expect(verifyPkceS256(`${VERIFIER.slice(0, -1)}Y`, CHALLENGE)).toBe(false);
  });

  it('refuses a verifier shorter than 43 characters', () => {
    expect(verifyPkceS256('a'.repeat(42), CHALLENGE)).toBe(false);
  });

  it('refuses a verifier longer than 128 characters', () => {
    expect(verifyPkceS256('a'.repeat(129), CHALLENGE)).toBe(false);
  });

  it('refuses a verifier outside the unreserved alphabet', () => {
    expect(verifyPkceS256(`${VERIFIER.slice(0, -1)}+`, CHALLENGE)).toBe(false);
  });

  it('accepts the whole unreserved alphabet at the length bounds', () => {
    // Refused on the hash, not the shape: the result is false without throwing.
    expect(verifyPkceS256('A-._~'.repeat(9).slice(0, 43), CHALLENGE)).toBe(false);
    expect(verifyPkceS256('z'.repeat(128), CHALLENGE)).toBe(false);
  });
});

describe('isPkceS256Challenge', () => {
  it('accepts a 43-character base64url value', () => {
    expect(isPkceS256Challenge(CHALLENGE)).toBe(true);
  });

  it.each([`${CHALLENGE}=`, CHALLENGE.slice(1), `${CHALLENGE.slice(1)}+`, 'plain-challenge'])('refuses %s', value => {
    expect(isPkceS256Challenge(value)).toBe(false);
  });
});
