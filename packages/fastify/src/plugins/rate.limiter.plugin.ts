import { consumeRateLimit, RateLimiter } from '@maroonedsoftware/servercore';
import { serverKitPlugin, type ServerKitPlugin } from '../serverkit.plugin.js';

/**
 * Enforces rate limiting per client IP using a `rate-limiter-flexible` instance.
 * Consumes one token per request in an `onRequest` hook; throws HTTP 429 (with `retry-after`
 * and `x-ratelimit-*` headers) when the limit is exceeded.
 *
 * @param rateLimiter - A {@link RateLimiter} instance (e.g. `RateLimiterMemory`, `RateLimiterRedis`).
 * @returns A {@link ServerKitPlugin} that installs the hook.
 */
export const rateLimiterPlugin = (rateLimiter: RateLimiter): ServerKitPlugin => {
  return serverKitPlugin('serverkit.rate.limiter', async app => {
    app.addHook('onRequest', async request => {
      await consumeRateLimit(rateLimiter, request.ip);
    });
  });
};
