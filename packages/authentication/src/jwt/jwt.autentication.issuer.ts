import { Injectable } from 'injectkit';
import { JwtPayload } from 'jsonwebtoken';
import { AuthenticationSession } from '../types.js';

/**
 * Abstract base class for JWT issuer validators.
 *
 * Extend this class and register your concrete implementation in the DI container
 * keyed by the issuer identifier (the `iss` claim value from the JWT).
 * {@link JwtAuthenticationHandler} resolves the matching issuer at runtime and
 * delegates to {@link parse} with both the raw `token` and the decoded `payload`.
 *
 * **Implementations MUST cryptographically verify the token's signature.** The
 * `payload` argument is supplied as a convenience but originates from an
 * unverified `jsonwebtoken.decode` call — it is only safe to trust after the
 * implementation has re-verified the signature against its own trusted key
 * material (e.g. JWKS, static public key).
 *
 * @example
 * ```typescript
 * class MyIssuer extends JwtAuthenticationIssuer {
 *   async parse(token: string, payload: JwtPayload): Promise<AuthenticationSession> {
 *     const verified = jsonwebtoken.verify(token, this.publicKey, { algorithms: ['RS256'], issuer: '...' });
 *     return { sessionToken: (verified as JwtPayload).sub ?? '', ... };
 *   }
 * }
 * ```
 */
@Injectable()
export abstract class JwtAuthenticationIssuer {
  /**
   * Verify a raw JWT and convert it into an {@link AuthenticationSession}.
   *
   * Called by {@link JwtAuthenticationHandler} after the issuer is matched from
   * the decoded `iss` claim. Implementations MUST verify the signature against
   * trusted key material before trusting any claim in `payload`; the payload is
   * passed for convenience but originates from an unverified
   * `jsonwebtoken.decode`.
   *
   * @param token   - The raw JWT string as received from the client.
   * @param payload - The decoded (but unverified) JWT payload.
   * @returns A promise resolving to an {@link AuthenticationSession}.
   * @throws When the token is invalid, expired, or untrusted.
   */
  abstract parse(token: string, payload: JwtPayload): Promise<AuthenticationSession>;
}
