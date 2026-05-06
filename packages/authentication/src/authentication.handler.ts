import { AuthenticationSession } from './types.js';

/**
 * An HTTP Authorization scheme string (e.g. `"Bearer"`, `"Basic"`).
 * The type accepts any string so custom schemes can be registered.
 */
export type AuthorizationScheme = 'bearer' | 'basic' | string;

/**
 * Implemented by classes that know how to validate a credential for a specific
 * authorization scheme and produce an {@link AuthenticationSession}.
 */
export interface AuthenticationHandler {
  /**
   * Validate the raw credential value for the given scheme.
   *
   * @param scheme - The authorization scheme extracted from the `Authorization` header.
   * @param value  - The raw credential string that follows the scheme (e.g. the JWT token).
   * @returns A resolved {@link AuthenticationSession} on success.
   * @throws When the credential is invalid or verification fails.
   */
  authenticate(scheme: AuthorizationScheme, value: string): Promise<AuthenticationSession>;
}
