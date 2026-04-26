import { Injectable } from 'injectkit';
import { CacheProvider } from '@maroonedsoftware/cache';
import { pkceCreateChallenge } from '@maroonedsoftware/encryption';
import { Duration } from 'luxon';

/**
 * Cache-backed storage for PKCE pairs (per [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636)).
 *
 * Stores arbitrary string `value`s keyed by a code challenge, namespaced under
 * the `pkce_` prefix. Used to bind a piece of state (e.g. a redirect URL,
 * upstream auth params, or a transaction id) to the challenge an OAuth/OIDC
 * client sent at the start of an authorization flow, so the matching verifier
 * can later retrieve it at the token endpoint.
 *
 * Each method comes in two forms:
 * - `*Challenge` — caller already has the SHA-256 / base64url challenge.
 * - `*Verifier` — caller has the verifier; the challenge is derived via
 *   {@link pkceCreateChallenge} before the cache call.
 *
 * Entries expire automatically via the cache TTL passed to `store*`.
 *
 * @example
 * ```typescript
 * // Authorize step: client sends `codeChallenge`; we bind a redirect URL to it
 * await pkce.storeChallenge(codeChallenge, redirectUrl, Duration.fromObject({ minutes: 10 }));
 *
 * // Token step: client sends back `codeVerifier`
 * const redirectUrl = await pkce.getVerifier(codeVerifier);
 * if (!redirectUrl) throw httpError(400);
 * await pkce.deleteVerifier(codeVerifier); // single-use
 * ```
 */
@Injectable()
export class PkceProvider {
  constructor(private readonly cache: CacheProvider) {}

  private getCacheKey(key: string) {
    return `pkce_${key}`;
  }

  /**
   * Store `value` under the given code challenge with a TTL.
   *
   * @param codeChallenge - The base64url SHA-256 challenge sent by the client.
   * @param value         - Opaque string to retrieve later (e.g. JSON state).
   * @param expiration    - How long the entry survives before the cache evicts it.
   */
  async storeChallenge(codeChallenge: string, value: string, expiration: Duration) {
    await this.cache.set(this.getCacheKey(codeChallenge), value, expiration);
  }

  /**
   * Same as {@link storeChallenge} but takes the verifier and derives the
   * challenge for you. Use this when you control both halves of the PKCE pair.
   */
  async storeVerifier(codeVerifier: string, value: string, expiration: Duration) {
    await this.storeChallenge(pkceCreateChallenge(codeVerifier), value, expiration);
  }

  /**
   * Look up the value previously stored under `codeChallenge`.
   *
   * @returns The stored string, or `null` if no entry exists or it has expired.
   */
  async getChallenge(codeChallenge: string) {
    return await this.cache.get(this.getCacheKey(codeChallenge));
  }

  /**
   * Look up the value previously stored for `codeVerifier`'s challenge — the
   * standard PKCE token-endpoint operation.
   *
   * @returns The stored string, or `null` when the verifier does not match any
   *   cached challenge (wrong verifier, expired entry, or already consumed).
   */
  async getVerifier(codeVerifier: string) {
    return await this.getChallenge(pkceCreateChallenge(codeVerifier));
  }

  /**
   * Remove the entry for `codeChallenge`. Call after a successful exchange to
   * enforce single-use semantics.
   */
  async deleteChallenge(codeChallenge: string) {
    await this.cache.delete(this.getCacheKey(codeChallenge));
  }

  /**
   * Remove the entry for `codeVerifier`'s challenge. Call after a successful
   * exchange to enforce single-use semantics.
   */
  async deleteVerifier(codeVerifier: string) {
    await this.deleteChallenge(pkceCreateChallenge(codeVerifier));
  }
}
