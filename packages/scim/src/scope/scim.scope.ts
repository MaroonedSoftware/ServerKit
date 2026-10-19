import { type AuthenticationSession, getSessionScopes, invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { scimError } from '../errors/scim.error.js';

/**
 * The SCIM scopes a session carries: `session.claims.scimScopes` when the consumer set it, else the
 * scopes the session was delegated (`getSessionScopes`: an API key's `claims.apiKey.scopes` or an
 * OAuth grant's `claims.oauth.scope`), so a session minted by `ApiKeyService` works as it is.
 */
const scimScopesOf = (session: AuthenticationSession | undefined): unknown => {
  const claims = session?.claims as Record<string, unknown> | undefined;
  if (!session || !claims) return undefined;
  if ('scimScopes' in claims) return claims.scimScopes;
  return getSessionScopes(session);
};

/**
 * Whether an authentication session carries a SCIM scope. The scope list is read from
 * `session.claims.scimScopes`, a string array the consumer populates when minting the session for
 * the bearer token, or, when that claim is absent, from the session's delegated scopes (an API
 * key's or an OAuth grant's). The wildcard scope `*` grants every check.
 *
 * Transport-neutral: the Koa and Fastify `requireScimScope` guards both call through
 * {@link assertScimScope}, which uses this.
 */
export const hasScimScope = (session: AuthenticationSession | undefined, scope: string): boolean => {
  const granted = scimScopesOf(session);
  return Array.isArray(granted) && (granted.includes('*') || granted.includes(scope));
};

/**
 * Throw unless the session is valid and carries `scope` (see {@link hasScimScope}).
 *
 * @throws {ScimError} 401 with `WWW-Authenticate: Bearer error="invalid_token"` when the session
 *   is missing or `invalidAuthenticationSession`.
 * @throws {ScimError} 403 `insufficientScope` when the scope is not granted.
 */
export const assertScimScope = (session: AuthenticationSession | undefined, scope: string): void => {
  if (!session || session === invalidAuthenticationSession) {
    throw scimError(401, undefined, 'Unauthorized')
      .addHeader('WWW-Authenticate', 'Bearer error="invalid_token"')
      .withDetails({ message: 'Missing or invalid bearer token' });
  }
  if (!hasScimScope(session, scope)) {
    throw scimError(403, 'insufficientScope', 'Forbidden').withDetails({ message: `Scope "${scope}" required` });
  }
};
