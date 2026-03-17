import { invalidAuthenticationContext } from '@maroonedsoftware/authentication';
import { ServerKitRouterMiddleware } from '../../serverkit.middleware.js';
import { httpError, unauthorizedError } from '@maroonedsoftware/errors';

/**
 * Options for {@link requireSecurity}.
 */
type SecurityOptions = {
  /** When set, the authenticated user must have this role in their `AuthenticationContext.roles` array. */
  roles?: string[];
};

/**
 * Router middleware that enforces authentication and optional role-based authorization.
 *
 * Reads `ctx.authenticationContext` (set by `authenticationMiddleware`) and:
 * - Throws HTTP 401 with a `WWW-Authenticate: Bearer error="invalid_token"` header
 *   if the context is `invalidAuthenticationContext`.
 * - Throws HTTP 403 if `options.role` is specified and the user does not have that role.
 * - Calls `next()` otherwise.
 *
 * @param options - Optional {@link SecurityOptions} for role-based access control.
 * @returns A {@link ServerKitRouterMiddleware} that guards the route.
 *
 * @example
 * ```typescript
 * // Require any authenticated user
 * router.get('/profile', requireSecurity(), handler);
 *
 * // Require the 'admin' role
 * router.delete('/users/:id', requireSecurity({ role: 'admin' }), handler);
 * ```
 */
export const requireSecurity = (options?: SecurityOptions): ServerKitRouterMiddleware => {
  return async (ctx, next) => {
    const authenticationContext = ctx.authenticationContext;

    if (authenticationContext === invalidAuthenticationContext) {
      throw unauthorizedError('Bearer error="invalid_token"');
    }

    if (options?.roles && options.roles.length > 0 && !options.roles.some(role => authenticationContext.roles.includes(role))) {
      throw httpError(403).withInternalDetails({
        message: 'Insufficient role',
        requiredRoles: options.roles,
        userRoles: authenticationContext.roles.join(', '),
      });
    }

    await next();
  };
};
