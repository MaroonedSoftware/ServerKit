import type { OAuthErrorCode } from './oauth.types.js';

/** What an authorization response carries back to the client. */
export interface AuthorizationRedirectParams {
  /** The issuer, sent on every response ([RFC 9207](https://datatracker.ietf.org/doc/html/rfc9207)) so a client can detect a mix-up. */
  iss: string;
  code?: string;
  state?: string;
  error?: OAuthErrorCode;
  error_description?: string;
}

/**
 * The URL to send the user back to the client with: `redirectUri` with the
 * response parameters added to its query, keeping any query it already had.
 * `iss` is added on success and error alike.
 */
export const buildAuthorizationRedirect = (redirectUri: string, params: AuthorizationRedirectParams): string => {
  const url = new URL(redirectUri);
  for (const name of ['code', 'state', 'error', 'error_description', 'iss'] as const) {
    const value = params[name];
    if (value !== undefined) url.searchParams.set(name, value);
  }
  return url.toString();
};
