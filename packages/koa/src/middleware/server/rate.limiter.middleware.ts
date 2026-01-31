import { RateLimiterAbstract } from 'rate-limiter-flexible';
import { ServerKitMiddleware } from '../../serverkit.middleware.js';
import { httpError } from '@maroonedsoftware/errors';

/**
 * Enforces rate limiting per client IP using a `rate-limiter-flexible` instance.
 * Consumes one token per request; throws HTTP 429 when the limit is exceeded.
 *
 * @param rateLimiter - A {@link RateLimiterAbstract} instance (e.g. `RateLimiterMemory`, `RateLimiterRedis`).
 * @returns {@link ServerKitMiddleware} that consumes a token and continues or throws 429.
 */
export const rateLimiterMiddleware = (rateLimiter: RateLimiterAbstract): ServerKitMiddleware => {
  return async (ctx, next) => {
    try {
      await rateLimiter.consume(ctx.ip);
    } catch (error) {
      throw httpError(429).withCause(error as Error);
    }

    await next();
  };
};
