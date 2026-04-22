import { ServerKitMiddleware } from '../../serverkit.middleware.js';

/**
 * Development-only middleware that injects a hardcoded Authorization header when none is present.
 *
 * @param fakeSecurityToken - The token value to set as the Authorization header.
 *
 * @remarks Remove before deploying to production.
 */
export const fakeSecurityMiddleware = (fakeSecurityToken: string): ServerKitMiddleware => {
  return async (ctx, next) => {
    ctx.logger.warn('Using fake security middleware, remove this middleware before production');

    if (!ctx.req.headers.authorization) {
      ctx.req.headers.authorization = fakeSecurityToken;
    }

    await next();
  };
};
