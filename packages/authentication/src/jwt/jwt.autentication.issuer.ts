import { Injectable } from 'injectkit';
import { JwtPayload } from 'jsonwebtoken';
import { AuthenticationContext } from '../authentication.context.js';

/**
 * Abstract base class for JWT issuer validators.
 *
 * Extend this class and register your concrete implementation in the DI container
 * keyed by the issuer identifier (the `iss` claim value from the JWT).
 * {@link JwtAuthenticationHandler} resolves the matching issuer at runtime and
 * delegates to {@link parse} with the decoded payload.
 *
 * @example
 * ```typescript
 * class MyIssuer extends JwtAuthenticationIssuer {
 *   async parse(payload: JwtPayload): Promise<AuthenticationContext> {
 *     // verify signature, expiry, audience, etc.
 *     return { authenticationId: payload.jti ?? '', ... };
 *   }
 * }
 * ```
 */
@Injectable()
export abstract class JwtAuthenticationIssuer {
  /**
   * Convert a decoded JWT payload into an {@link AuthenticationContext}.
   *
   * Called by {@link JwtAuthenticationHandler} after the token is decoded and the
   * issuer matched. Implementations should verify the token signature, validate
   * claims (expiry, audience, etc.), and map payload fields to the returned context.
   *
   * @param payload - The decoded JWT payload (from `jsonwebtoken.decode`).
   * @returns A promise resolving to an {@link AuthenticationContext}.
   * @throws When the token is invalid, expired, or untrusted.
   */
  abstract parse(payload: JwtPayload): Promise<AuthenticationContext>;
}
