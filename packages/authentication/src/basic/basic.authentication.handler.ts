import { Injectable } from 'injectkit';
import { AuthenticationHandler, AuthorizationScheme } from '../authentication.handler.js';
import { invalidAuthenticationSession } from '../types.js';
import { BasicAuthenticationIssuer } from './basic.authentication.issuer.js';

/**
 * Handles HTTP Basic authentication by base64-decoding the credential,
 * splitting it into a username/password pair, and delegating verification
 * to the injected {@link BasicAuthenticationIssuer}.
 *
 * Returns {@link invalidAuthenticationSession} when:
 * - The scheme is not `"basic"`.
 * - The decoded credential is missing a username or password.
 */
@Injectable()
export class BasicAuthenticationHandler implements AuthenticationHandler {
  /** @param issuer - Strategy responsible for verifying username/password pairs. */
  constructor(private readonly issuer: BasicAuthenticationIssuer) {}

  /**
   * Authenticate a Basic credential.
   *
   * @param scheme - The authorization scheme from the `Authorization` header.
   *   Must equal `"basic"` (case-sensitive) or {@link invalidAuthenticationSession} is returned.
   * @param value - The base64-encoded `username:password` string that follows the scheme.
   * @returns The {@link AuthenticationSession} produced by the issuer on success,
   *   or {@link invalidAuthenticationSession} when the credential is missing or the scheme does not match.
   */
  async authenticate(scheme: AuthorizationScheme, value: string) {
    if (scheme !== 'basic') {
      return invalidAuthenticationSession;
    }

    const decoded = Buffer.from(value, 'base64').toString('utf-8');
    const [username, password] = decoded.split(':');

    if (username && password) {
      return await this.issuer.verify(username, password);
    }

    return invalidAuthenticationSession;
  }
}
