import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { pkceCreateChallenge, pkceCreateVerifier } from '../../src/pkce/pkce.js';

const BASE64URL = /^[A-Za-z0-9\-_]+$/;

describe('pkceCreateVerifier', () => {
  it('returns a 43-character base64url string (256 bits → 32 bytes)', () => {
    const verifier = pkceCreateVerifier();
    expect(verifier).toHaveLength(43);
    expect(BASE64URL.test(verifier)).toBe(true);
  });

  it('contains no base64 padding or non-url-safe characters', () => {
    const verifier = pkceCreateVerifier();
    expect(verifier.includes('=')).toBe(false);
    expect(verifier.includes('+')).toBe(false);
    expect(verifier.includes('/')).toBe(false);
  });

  it('returns a different value on each call', () => {
    const a = pkceCreateVerifier();
    const b = pkceCreateVerifier();
    expect(a).not.toBe(b);
  });
});

describe('pkceCreateChallenge', () => {
  it('returns a 43-character base64url string (SHA-256 digest)', () => {
    const challenge = pkceCreateChallenge(pkceCreateVerifier());
    expect(challenge).toHaveLength(43);
    expect(BASE64URL.test(challenge)).toBe(true);
  });

  it('contains no base64 padding or non-url-safe characters', () => {
    const challenge = pkceCreateChallenge('any-verifier');
    expect(challenge.includes('=')).toBe(false);
    expect(challenge.includes('+')).toBe(false);
    expect(challenge.includes('/')).toBe(false);
  });

  it('is deterministic for the same verifier', () => {
    const verifier = pkceCreateVerifier();
    expect(pkceCreateChallenge(verifier)).toBe(pkceCreateChallenge(verifier));
  });

  it('returns different challenges for different verifiers', () => {
    const a = pkceCreateChallenge(pkceCreateVerifier());
    const b = pkceCreateChallenge(pkceCreateVerifier());
    expect(a).not.toBe(b);
  });

  it('matches SHA-256(verifier) base64url-encoded — RFC 7636 S256', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const expected = createHash('sha256')
      .update(verifier, 'utf8')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    expect(pkceCreateChallenge(verifier)).toBe(expected);
  });

  it('reproduces the example challenge from RFC 7636 Appendix B', () => {
    // RFC 7636 §B: verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    // → challenge "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    expect(pkceCreateChallenge(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
});
