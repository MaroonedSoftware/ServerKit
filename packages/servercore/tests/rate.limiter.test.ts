import { describe, it, expect } from 'vitest';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { HttpError } from '@maroonedsoftware/errors';
import { consumeRateLimit } from '../src/ratelimit/rate.limiter.js';

describe('consumeRateLimit', () => {
  it('resolves while points remain', async () => {
    const limiter = new RateLimiterMemory({ points: 2, duration: 1 });

    await expect(consumeRateLimit(limiter, '10.0.0.1')).resolves.toBeUndefined();
    await expect(consumeRateLimit(limiter, '10.0.0.1')).resolves.toBeUndefined();
  });

  it('throws 429 with rate-limit headers once the limit is exceeded', async () => {
    const limiter = new RateLimiterMemory({ points: 1, duration: 60 });
    await consumeRateLimit(limiter, '10.0.0.2');

    let caught: unknown;
    try {
      await consumeRateLimit(limiter, '10.0.0.2');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(HttpError);
    const error = caught as HttpError;
    expect(error.statusCode).toBe(429);
    expect(error.headers).toMatchObject({ 'x-ratelimit-limit': '1', 'x-ratelimit-remaining': '0' });
    expect(Number(error.headers?.['retry-after'])).toBeGreaterThan(0);
    expect(Number(error.headers?.['x-ratelimit-reset'])).toBeGreaterThan(0);
  });

  it('keys buckets independently', async () => {
    const limiter = new RateLimiterMemory({ points: 1, duration: 60 });
    await consumeRateLimit(limiter, 'a');

    await expect(consumeRateLimit(limiter, 'b')).resolves.toBeUndefined();
  });

  it('throws 429 without headers when the limiter fails for another reason', async () => {
    const limiter = {
      points: 5,
      consume: () => Promise.reject(new Error('store unavailable')),
    } as unknown as RateLimiterMemory;

    await expect(consumeRateLimit(limiter, 'x')).rejects.toMatchObject({ statusCode: 429, headers: {} });
  });
});
