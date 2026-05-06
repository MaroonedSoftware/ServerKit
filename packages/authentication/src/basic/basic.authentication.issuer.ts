import { Injectable } from 'injectkit';
import { AuthenticationSession } from '../types.js';

/**
 * Abstract base class for verifying HTTP Basic authentication credentials.
 *
 * Extend this class and implement {@link verify} to look up the user by
 * username and validate the provided password (e.g. via bcrypt comparison).
 * Register the concrete implementation in your DI container so that
 * {@link BasicAuthenticationHandler} can resolve it.
 */
@Injectable()
export abstract class BasicAuthenticationIssuer {
  /**
   * Verify a username/password pair and return the resulting authentication session.
   *
   * @param username - The plaintext username extracted from the Basic credential.
   * @param password - The plaintext password extracted from the Basic credential.
   * @returns A resolved {@link AuthenticationSession} on success, or
   *   {@link invalidAuthenticationSession} when the credentials are invalid.
   */
  abstract verify(username: string, password: string): Promise<AuthenticationSession>;
}
