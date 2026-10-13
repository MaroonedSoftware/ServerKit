import type { preHandlerAsyncHookHandler } from 'fastify';
import type {} from '@maroonedsoftware/fastify';
import { assertScimScope } from '../scope/scim.scope.js';

/**
 * Route guard enforcing that the current request carries a SCIM scope on its authentication
 * session. The scope list is read from `request.authenticationSession.claims.scimScopes` (set by
 * `authenticationPlugin` from `@maroonedsoftware/fastify`), a string array the consumer populates
 * when minting the session for the bearer token.
 *
 * Wildcard scope `*` in the session grants every check. The check itself is
 * {@link assertScimScope}, shared with the Koa transport.
 *
 * @param scope - The scope the route requires.
 * @returns A Fastify hook handler for {@link ScimRoutesOptions.routeGuards} (or any route's `preHandler`).
 * @throws {ScimError} 401 when the session is missing or invalid, 403 `insufficientScope` when the scope is not granted.
 */
export const requireScimScope = (scope: string): preHandlerAsyncHookHandler => {
  return async request => {
    assertScimScope(request.authenticationSession, scope);
  };
};
