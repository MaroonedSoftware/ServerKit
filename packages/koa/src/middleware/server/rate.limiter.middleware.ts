import { RateLimiterAbstract, RateLimiterRes } from 'rate-limiter-flexible';
import { ServerKitMiddleware } from '../../serverkit.middleware.js';
import { httpError } from '@maroonedsoftware/errors';

const isRateLimiterError = (error: unknown): error is RateLimiterRes => {
  return error instanceof RateLimiterRes || ('msBeforeNext' in (error as object) && 'remainingPoints' in (error as object));
};

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
    } catch (error: unknown) {
      let headers: Record<string, string> = {};
      if (isRateLimiterError(error)) {
        headers = {
          'retry-after': (error.msBeforeNext / 1000).toString(),
          'x-ratelimit-limit': rateLimiter.points.toString(),
          'x-ratelimit-remaining': error.remainingPoints.toString(),
          'x-ratelimit-reset': Math.ceil((Date.now() + error.msBeforeNext) / 1000).toString(),
        };
      }

      throw httpError(429)
        .withCause(error as Error)
        .withHeaders(headers);
    }

    await next();
  };
};
