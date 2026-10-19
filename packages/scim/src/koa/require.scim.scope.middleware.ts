import type { ServerKitRouterMiddleware } from '@maroonedsoftware/koa';
import { assertScimScope } from '../scope/scim.scope.js';

/**
 * Router middleware enforcing that the current request carries a SCIM scope
 * on its authentication session. The scope list is read from
 * `ctx.authenticationSession.claims.scimScopes` — a string array the consumer
 * populates when minting the session for the bearer token — or, when that claim
 * is absent, from the session's delegated scopes (an `ApiKeyService` key's or an
 * OAuth grant's).
 *
 * Wildcard scope `*` in the session grants every check. The check itself is
 * {@link assertScimScope}, shared with the Fastify transport.
 */
export const requireScimScope = (scope: string): ServerKitRouterMiddleware => {
  return async (ctx, next) => {
    assertScimScope(ctx.authenticationSession, scope);
    await next();
  };
};
