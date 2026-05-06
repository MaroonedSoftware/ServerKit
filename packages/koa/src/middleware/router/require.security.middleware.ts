import { invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { ServerKitRouterMiddleware } from '../../serverkit.middleware.js';
import { unauthorizedError } from '@maroonedsoftware/errors';

/**
 * Options for {@link requireSecurity}.
 *
 * Reserved for future role/scope-based checks; currently the middleware only
 * enforces that an authentication session is present.
 */
type SecurityOptions = {
  /** Reserved — role enforcement is not currently wired up. */
  roles?: string[];
};

/**
 * Router middleware that enforces a valid authentication session.
 *
 * Reads `ctx.authenticationSession` (set by `authenticationMiddleware`) and
 * throws HTTP 401 with a `WWW-Authenticate: Bearer error="invalid_token"`
 * header when the session is `invalidAuthenticationSession`. Otherwise calls
 * `next()`.
 *
 * @returns A {@link ServerKitRouterMiddleware} that guards the route.
 *
 * @example
 * ```typescript
 * // Require any authenticated user
 * router.get('/profile', requireSecurity(), handler);
 * ```
 */
export const requireSecurity = (_options?: SecurityOptions): ServerKitRouterMiddleware => {
  return async (ctx, next) => {
    const authenticationSession = ctx.authenticationSession;

    if (authenticationSession === invalidAuthenticationSession) {
      throw unauthorizedError('Bearer error="invalid_token"');
    }

    await next();
  };
};
