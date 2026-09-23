import { pkceCreateChallenge } from '@maroonedsoftware/encryption';
import { timingSafeCompare } from '../helpers.js';

/** A code verifier's alphabet and length ([RFC 7636 §4.1](https://datatracker.ietf.org/doc/html/rfc7636#section-4.1)). */
const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

/** An `S256` challenge: base64url of a SHA-256 digest, 43 characters, no padding. */
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** `true` when `codeChallenge` is shaped like an `S256` challenge. */
export const isPkceS256Challenge = (codeChallenge: string): boolean => S256_CHALLENGE.test(codeChallenge);

/**
 * Verify a PKCE code verifier against the `S256` challenge it must hash to
 * ([RFC 7636 §4.6](https://datatracker.ietf.org/doc/html/rfc7636#section-4.6)).
 *
 * A verifier outside the RFC's alphabet or length is refused without hashing.
 * The comparison is constant-time.
 */
export const verifyPkceS256 = (codeVerifier: string, codeChallenge: string): boolean => {
  if (!CODE_VERIFIER.test(codeVerifier)) return false;
  return timingSafeCompare(pkceCreateChallenge(codeVerifier), codeChallenge);
};
