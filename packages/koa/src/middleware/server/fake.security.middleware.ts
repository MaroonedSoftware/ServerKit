import { ServerKitMiddleware } from '../../serverkit.middleware.js';

export const fakeSecurityMiddleware = (fakeSecurityToken: string): ServerKitMiddleware => {
  return async (ctx, next) => {
    ctx.logger.warn('Using fake security middleware, remove this middleware before production');

    if (!ctx.req.headers.authorization) {
      ctx.req.headers.authorization = fakeSecurityToken;
    }

    await next();
  };
};
