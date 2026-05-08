import { invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { ServerKitRouterMiddleware } from '../../serverkit.middleware.js';
import { unauthorizedError } from '@maroonedsoftware/errors';

/**
 * Options for {@link requireSecurity}.
 *
 * Enforces that an authentication session is present and optionally that
 * multi-factor authentication has been completed.
 */
type SecurityOptions = {
  /** Whether to require multi-factor authentication. */
  requireMfa: boolean;
};

/**
 * Router middleware that enforces a valid authentication session and, by
 * default, multi-factor authentication.
 *
 * Reads `ctx.authenticationSession` (set by `authenticationMiddleware`) and:
 *
 * - Throws HTTP 401 with `WWW-Authenticate: Bearer error="invalid_token"`
 *   when the session is `invalidAuthenticationSession`.
 * - When `requireMfa` is true (the default), throws HTTP 401 with
 *   `WWW-Authenticate: Bearer error="mfa_required"` if the session has fewer
 *   than two factors or every factor is of `kind: 'knowledge'` (i.e. no
 *   `possession` or `biometric` factor was satisfied).
 * - Otherwise calls `next()`.
 *
 * @param options - Security requirements for the route. Defaults to
 *   `{ requireMfa: true }`.
 * @returns A {@link ServerKitRouterMiddleware} that guards the route.
 * @throws {HttpError} 401 when the session is invalid or MFA is required but
 *   not satisfied.
 *
 * @example
 * ```typescript
 * // Require an authenticated user with MFA
 * router.get('/profile', requireSecurity(), handler);
 *
 * // Require authentication only (e.g. for a step-up MFA enrollment route)
 * router.post('/mfa/enroll', requireSecurity({ requireMfa: false }), handler);
 * ```
 */
export const requireSecurity = (options: SecurityOptions = { requireMfa: true }): ServerKitRouterMiddleware => {
  return async (ctx, next) => {
    const authenticationSession = ctx.authenticationSession;

    if (authenticationSession === invalidAuthenticationSession) {
      throw unauthorizedError('Bearer error="invalid_token"');
    }

    if (
      options.requireMfa &&
      (authenticationSession.factors.length < 2 || authenticationSession.factors.every(factor => factor.kind === 'knowledge'))
    ) {
      throw unauthorizedError('Bearer error="mfa_required"');
    }

    await next();
  };
};
