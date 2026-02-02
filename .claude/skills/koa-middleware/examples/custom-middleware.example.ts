import { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';

/**
 * Authentication middleware
 *
 * @description Validates Bearer token and attaches user to context
 */
export const authMiddleware = (): ServerKitMiddleware => {
  return async (ctx, next) => {
    ctx.logger.info('Running auth middleware', { requestId: ctx.requestId });

    try {
      // Code before next() runs BEFORE the route handler
      const authHeader = ctx.request.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw httpError(401)
          .withDetails({ message: 'Missing or invalid authorization header' })
          .withHeaders({ 'WWW-Authenticate': 'Bearer' });
      }

      const token = authHeader.substring(7);

      // TODO: Validate token and get user
      // const authService = ctx.container.get(AuthService);
      // const user = await authService.validateToken(token);
      //
      // if (!user) {
      //   throw httpError(401).withDetails({ message: 'Invalid token' });
      // }

      // Attach user to context (extend ServerKitContext in types)
      // (ctx as any).user = user;

      await next();

      // Code after next() runs AFTER the route handler
      // This is useful for response modification, logging, etc.
      ctx.logger.info('Auth middleware completed', {
        requestId: ctx.requestId,
        status: ctx.status
      });
    } catch (error) {
      // Handle or re-throw errors
      ctx.logger.error('Auth middleware error', {
        requestId: ctx.requestId,
        error
      });
      throw error;
    }
  };
};

/**
 * Rate limiting middleware
 *
 * @description Limits requests per IP address
 */
export const rateLimitMiddleware = (
  maxRequests: number = 100,
  windowMs: number = 60000
): ServerKitMiddleware => {
  const requests = new Map<string, { count: number; resetAt: number }>();

  return async (ctx, next) => {
    const ip = ctx.request.ip;
    const now = Date.now();

    // Get or create rate limit entry
    let entry = requests.get(ip);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      requests.set(ip, entry);
    }

    entry.count++;

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      throw httpError(429)
        .withDetails({ message: 'Too many requests' })
        .withHeaders({ 'Retry-After': retryAfter.toString() });
    }

    // Add rate limit headers
    ctx.set('X-RateLimit-Limit', maxRequests.toString());
    ctx.set('X-RateLimit-Remaining', (maxRequests - entry.count).toString());
    ctx.set('X-RateLimit-Reset', entry.resetAt.toString());

    await next();
  };
};
