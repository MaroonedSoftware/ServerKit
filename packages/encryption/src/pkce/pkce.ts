import * as crypto from 'crypto';

/**
 * Generate a fresh PKCE code verifier — a 256-bit random value encoded with
 * base64url (no padding), per [RFC 7636 §4.1](https://datatracker.ietf.org/doc/html/rfc7636#section-4.1).
 *
 * The verifier is the secret half of a PKCE pair: keep it on the client and
 * only transmit the derived challenge to the authorization server. The verifier
 * is later sent to the token endpoint to prove possession.
 *
 * @returns A 43-character base64url string (256 bits of entropy).
 */
export const pkceCreateVerifier = () => {
  const key = crypto.randomBytes(32);

  return btoa(new Uint8Array(key).reduce((data, byte) => data + String.fromCharCode(byte), ''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
};

/**
 * Derive the PKCE code challenge from a verifier using the `S256` method —
 * SHA-256, base64url, no padding — per [RFC 7636 §4.2](https://datatracker.ietf.org/doc/html/rfc7636#section-4.2).
 *
 * The challenge is the public half of a PKCE pair: send it to the authorization
 * server during the initial request. The server stores it and later compares
 * `SHA256(verifier)` against it when the verifier arrives at the token endpoint.
 *
 * Calling this with the same verifier always returns the same challenge.
 *
 * @param codeVerifier - The verifier produced by {@link pkceCreateVerifier}.
 * @returns A 43-character base64url string.
 */
export const pkceCreateChallenge = (codeVerifier: string) => {
  const hash = crypto.createHash('sha256');
  const rawChallenge = hash.update(new TextEncoder().encode(codeVerifier)).digest();

  return btoa(new Uint8Array(rawChallenge).reduce((data, byte) => data + String.fromCharCode(byte), ''))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
};
