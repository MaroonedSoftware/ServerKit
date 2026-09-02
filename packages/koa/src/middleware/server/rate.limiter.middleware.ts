import { ServerKitMiddleware } from '../../serverkit.middleware.js';
import { consumeRateLimit, RateLimiter } from '@maroonedsoftware/servercore';

/**
 * DI token for an injected rate limiter, re-exported from `@maroonedsoftware/servercore` so
 * Koa apps keep importing it from here. Any concrete `rate-limiter-flexible` limiter
 * (e.g. `RateLimiterMemory`, `RateLimiterRedis`) can be registered against it.
 */
export { RateLimiter };

/**
 * Enforces rate limiting per client IP using a `rate-limiter-flexible` instance.
 * Consumes one token per request; throws HTTP 429 (with `retry-after` and `x-ratelimit-*`
 * headers) when the limit is exceeded.
 *
 * @param rateLimiter - A {@link RateLimiter} instance (e.g. `RateLimiterMemory`, `RateLimiterRedis`).
 * @returns {@link ServerKitMiddleware} that consumes a token and continues or throws 429.
 */
export const rateLimiterMiddleware = (rateLimiter: RateLimiter): ServerKitMiddleware => {
  return async (ctx, next) => {
    await consumeRateLimit(rateLimiter, ctx.ip);
    await next();
  };
};
