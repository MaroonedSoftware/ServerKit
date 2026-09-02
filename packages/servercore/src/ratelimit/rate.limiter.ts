import { RateLimiterRes } from 'rate-limiter-flexible';
import type { RateLimiterAbstract } from 'rate-limiter-flexible';
import { DateTime } from 'luxon';
import { httpError } from '@maroonedsoftware/errors';
import { Injectable } from 'injectkit';

/**
 * DI token for an injected rate limiter.
 *
 * `rate-limiter-flexible` only ships {@link RateLimiterAbstract} as a type (it is not part of the
 * package's runtime exports), so this token cannot `extends` it at runtime. Instead it is a bare
 * injectable class merged with the {@link RateLimiterAbstract} shape, letting any concrete limiter
 * (e.g. `RateLimiterMemory`, `RateLimiterRedis`) be registered against it while callers still see
 * the full `consume`/`points` API.
 */
/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface */
@Injectable()
export abstract class RateLimiter {}
export interface RateLimiter extends RateLimiterAbstract {}
/* eslint-enable @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface */

/** Type guard that narrows `error` to a `RateLimiterRes` (i.e. a rate-limit exceeded response). */
const isRateLimiterError = (error: unknown): error is RateLimiterRes => {
  return error instanceof RateLimiterRes || ('msBeforeNext' in (error as object) && 'remainingPoints' in (error as object));
};

/**
 * Consumes one point from `rateLimiter` for `key` (typically the client IP), throwing HTTP 429
 * when the limit is exceeded. The 429 carries `retry-after`, `x-ratelimit-limit`,
 * `x-ratelimit-remaining`, and `x-ratelimit-reset` headers derived from the limiter's response.
 *
 * This is the framework-neutral body of each adapter's rate-limiting middleware or hook.
 *
 * @param rateLimiter - A {@link RateLimiter} instance (e.g. `RateLimiterMemory`, `RateLimiterRedis`).
 * @param key - The bucket to consume from, usually the client IP.
 * @throws {HttpError} 429 when the limit is exceeded, with the rate-limit headers attached.
 */
export const consumeRateLimit = async (rateLimiter: RateLimiter, key: string): Promise<void> => {
  try {
    await rateLimiter.consume(key);
  } catch (error: unknown) {
    let headers: Record<string, string> = {};
    if (isRateLimiterError(error)) {
      headers = {
        'retry-after': (error.msBeforeNext / 1000).toString(),
        'x-ratelimit-limit': rateLimiter.points.toString(),
        'x-ratelimit-remaining': error.remainingPoints.toString(),
        'x-ratelimit-reset': Math.ceil(DateTime.now().plus({ milliseconds: error.msBeforeNext }).toSeconds()).toString(),
      };
    }

    throw httpError(429)
      .withCause(error as Error)
      .withHeaders(headers);
  }
};
