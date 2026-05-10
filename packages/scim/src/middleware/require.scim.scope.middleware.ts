import type { ServerKitRouterMiddleware } from '@maroonedsoftware/koa';
import { invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { scimError } from '../errors/scim.error.js';

/**
 * Router middleware enforcing that the current request carries a SCIM scope
 * on its authentication session. The scope list is read from
 * `ctx.authenticationSession.claims.scimScopes` — a string array the consumer
 * populates when minting the session for the bearer token.
 *
 * Wildcard scope `*` in the session grants every check.
 */
export const requireScimScope = (scope: string): ServerKitRouterMiddleware => {
  return async (ctx, next) => {
    const session = ctx.authenticationSession;
    if (!session || session === invalidAuthenticationSession) {
      throw scimError(401, undefined, 'Unauthorized')
        .addHeader('WWW-Authenticate', 'Bearer error="invalid_token"')
        .withDetails({ message: 'Missing or invalid bearer token' });
    }
    const granted = session.claims?.scimScopes;
    if (!Array.isArray(granted) || (!granted.includes('*') && !granted.includes(scope))) {
      throw scimError(403, 'insufficientScope', 'Forbidden').withDetails({ message: `Scope "${scope}" required` });
    }
    await next();
  };
};
