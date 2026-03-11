import { Injectable } from 'injectkit';
import { invalidAuthenticationContext } from '../authentication.context.js';
import { AuthenticationHandler, AuthorizationScheme } from '../authentication.handler.js';
import { JwtAuthenticationIssuer } from './jwt.autentication.issuer.js';
import jsonwebtoken from 'jsonwebtoken';
import { Logger } from '@maroonedsoftware/logger';

/**
 * DI-injectable registry of {@link JwtAuthenticationIssuer} instances keyed by their
 * `iss` claim value (e.g. `"https://auth.example.com"`).
 *
 * Register each issuer against its expected `iss` value so
 * {@link JwtAuthenticationHandler} can look it up at runtime.
 *
 * @example
 * ```typescript
 * registry
 *   .register(JwtAuthenticationIssuerMap)
 *   .useMap()
 *   .add('https://auth.example.com', MyIssuer);
 * ```
 */
@Injectable()
export class JwtAuthenticationIssuerMap extends Map<string, JwtAuthenticationIssuer> {}

/**
 * {@link AuthenticationHandler} implementation for the `bearer` scheme.
 *
 * Decodes the JWT (without signature verification) to extract the `iss` claim,
 * looks up the corresponding {@link JwtAuthenticationIssuer} in the injected
 * {@link JwtAuthenticationIssuerMap}, and delegates full verification to it.
 *
 * Returns {@link invalidAuthenticationContext} when:
 * - The scheme is not `bearer`
 * - The token cannot be decoded
 * - No issuer is registered for the token's `iss` claim
 *
 * @see {@link JwtAuthenticationIssuer} – implement this to validate tokens from a specific issuer
 */
@Injectable()
export class JwtAuthenticationHandler implements AuthenticationHandler {
  constructor(
    private readonly issuerMap: JwtAuthenticationIssuerMap,
    private readonly logger: Logger,
  ) {}

  /**
   * Authenticate a `bearer` credential by decoding the JWT and delegating to the
   * matching {@link JwtAuthenticationIssuer}.
   *
   * @param scheme - The authorization scheme (must be `'bearer'` to proceed).
   * @param value  - The raw JWT string.
   * @returns The {@link AuthenticationContext} from the issuer, or
   *   {@link invalidAuthenticationContext} if the token cannot be resolved.
   */
  async authenticate(scheme: AuthorizationScheme, value: string) {
    if (scheme !== 'bearer') {
      return invalidAuthenticationContext;
    }

    const decoded = jsonwebtoken.decode(value, { json: true });

    if (decoded) {
      const issuer = this.issuerMap.get(decoded.iss ?? '');

      if (issuer) {
        return await issuer.parse(decoded);
      } else {
        this.logger.warn('No JwtAuthenticationIssuer found for issuer', { issuer: decoded.iss });
      }
    }

    return invalidAuthenticationContext;
  }
}
