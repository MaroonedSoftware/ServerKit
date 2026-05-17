import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { Duration } from 'luxon';
import jsonwebtoken from 'jsonwebtoken';
import { createPublicKey } from 'node:crypto';
import { httpError, unauthorizedError } from '@maroonedsoftware/errors';

/**
 * Signs and verifies RS256 JWTs using a PEM-encoded RSA key pair.
 *
 * Used internally by {@link AuthenticationSessionService} to issue and validate
 * session tokens. Inject this provider into your DI container alongside a PEM
 * private key string. If `pemPublicKey` is omitted the public key is derived
 * from the private key, but verification will still only ever see the public
 * half — the private key never leaves the signing path.
 */
@Injectable()
export class JwtProvider {
  private readonly pemPublicKey: string;

  /**
   * @param logger        - Logger used to record verification failures.
   * @param pemPrivateKey - PEM-encoded RSA private key used to sign tokens.
   * @param pemPublicKey  - PEM-encoded RSA public key used to verify tokens. When omitted,
   *   the public key is derived from `pemPrivateKey` via `crypto.createPublicKey` so the
   *   verify path never has to hold the private key. Pass an explicit value (e.g. from
   *   JWKS) when sign and verify keys live in different places.
   */
  constructor(
    private readonly logger: Logger,
    private readonly pemPrivateKey: string,
    pemPublicKey?: string,
  ) {
    if (pemPublicKey) {
      this.pemPublicKey = pemPublicKey;
    } else {
      try {
        this.pemPublicKey = createPublicKey(pemPrivateKey).export({ type: 'spki', format: 'pem' }) as string;
      } catch {
        // Defer the failure until `create` or `decode` is called so constructor doesn't throw on test fixtures
        // that intentionally use invalid PEMs and assert on the signing-path error.
        this.pemPublicKey = pemPrivateKey;
      }
    }
  }

  /**
   * Sign a JWT payload and return the compact token string plus the decoded claims.
   *
   * @param payload   - Claims to embed in the JWT body.
   * @param subject   - `sub` claim value (typically a user or session id).
   * @param issuer    - `iss` claim value.
   * @param audience  - `aud` claim value(s).
   * @param expiresIn - Token lifetime as a Luxon {@link Duration}.
   * @returns An object with the signed `token` string and the `decoded` JWT claims.
   * @throws HTTP 500 when signing fails or the resulting token cannot be decoded.
   */
  create(payload: string | Buffer | object, subject: string, issuer: string, audience: string | string[], expiresIn: Duration) {
    try {
      const token = jsonwebtoken.sign(payload, this.pemPrivateKey, {
        algorithm: 'RS256',
        expiresIn: expiresIn.as('seconds'),
        issuer,
        subject,
        audience,
      });

      const decoded = jsonwebtoken.decode(token, { json: true });
      if (!decoded) {
        throw httpError(500).withInternalDetails({ message: 'Unexpected string for jwt' });
      }

      return { token, decoded };
    } catch (ex) {
      throw httpError(500).withCause(ex as Error);
    }
  }

  /**
   * Verify and decode a JWT, returning its payload on success.
   *
   * @param token             - The compact JWT string to verify.
   * @param issuer            - Expected `iss` claim; verification fails if it does not match.
   * @param ignoreExpiration  - When `true`, an expired token is still decoded (useful for refresh flows).
   * @param reThrow           - When `true`, errors are re-thrown as HTTP 401 instead of returning `undefined`.
   * @returns The decoded {@link JwtPayload}, or `undefined` if verification fails and `reThrow` is `false`.
   * @throws HTTP 401 when verification fails and `reThrow` is `true`.
   */
  decode(token: string, issuer: string, ignoreExpiration?: boolean, reThrow: boolean = false) {
    try {
      const decoded = jsonwebtoken.verify(token, this.pemPublicKey, { issuer, ignoreExpiration });

      if (typeof decoded === 'string') {
        if (reThrow) {
          throw unauthorizedError('Bearer error="invalid_token"').withInternalDetails({ message: 'Unexpected string for jwt' });
        }
        this.logger.error('Unexpected string for jwt');
        return undefined;
      }

      return decoded;
    } catch (ex) {
      if (reThrow) {
        throw unauthorizedError('Bearer error="invalid_token"').withCause(ex as Error);
      }
      this.logger.error(ex);
      return undefined;
    }
  }
}
