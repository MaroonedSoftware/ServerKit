import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimiterMiddleware } from '../../../src/middleware/server/rate.limiter.middleware.js';
import type { ServerKitContext } from '../../../src/serverkit.context.js';
import type { Next } from 'koa';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { IsHttpError, HttpError } from '@maroonedsoftware/errors';

describe('rateLimiterMiddleware', () => {
  let mockCtx: ServerKitContext;
  let mockNext: Next;

  beforeEach(() => {
    mockNext = (() => Promise.resolve()) as Next;
    mockCtx = {
      ip: '192.168.1.1',
    } as unknown as ServerKitContext;
  });

  it('should return a middleware function', () => {
    const rateLimiter = new RateLimiterMemory({ points: 10, duration: 1 });
    const middleware = rateLimiterMiddleware(rateLimiter);

    expect(middleware).toBeTypeOf('function');
    expect(middleware.length).toBe(2);
  });

  it('should call next() when consume succeeds', async () => {
    const rateLimiter = new RateLimiterMemory({ points: 10, duration: 1 });
    const middleware = rateLimiterMiddleware(rateLimiter);
    let nextCalled = false;
    const next = (() => { nextCalled = true; return Promise.resolve(); }) as Next;

    await middleware(mockCtx, next);

    expect(nextCalled).toBe(true);
  });

  it('should throw 429 HttpError when the rate limit is exceeded', async () => {
    const rateLimiter = new RateLimiterMemory({ points: 1, duration: 60 });
    const middleware = rateLimiterMiddleware(rateLimiter);

    await middleware(mockCtx, mockNext);

    let caught: unknown;
    try {
      await middleware(mockCtx, mockNext);
    } catch (e) {
      caught = e;
    }

    expect(IsHttpError(caught)).toBe(true);
    expect((caught as HttpError).statusCode).toBe(429);
  });

  it('should set Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, and X-RateLimit-Reset headers on 429', async () => {
    const rateLimiter = new RateLimiterMemory({ points: 1, duration: 60 });
    const middleware = rateLimiterMiddleware(rateLimiter);

    await middleware(mockCtx, mockNext);

    let caught: unknown;
    try {
      await middleware(mockCtx, mockNext);
    } catch (e) {
      caught = e;
    }

    expect(IsHttpError(caught)).toBe(true);
    const error = caught as HttpError;
    expect(error.headers).toBeDefined();
    expect(error.headers!['Retry-After']).toBeDefined();
    expect(Number(error.headers!['Retry-After'])).toBeGreaterThan(0);
    expect(error.headers!['X-RateLimit-Limit']).toBe('1');
    expect(error.headers!['X-RateLimit-Remaining']).toBe('0');
    expect(Number(error.headers!['X-RateLimit-Reset'])).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('should not call next when the rate limit is exceeded', async () => {
    const rateLimiter = new RateLimiterMemory({ points: 1, duration: 60 });
    const middleware = rateLimiterMiddleware(rateLimiter);

    await middleware(mockCtx, mockNext);

    let nextCallCount = 0;
    const next = (() => { nextCallCount++; return Promise.resolve(); }) as Next;

    await expect(middleware(mockCtx, next)).rejects.toThrow();
    expect(nextCallCount).toBe(0);
  });

  it('should track limits per IP address', async () => {
    const rateLimiter = new RateLimiterMemory({ points: 1, duration: 60 });
    const middleware = rateLimiterMiddleware(rateLimiter);
    const otherCtx = { ip: '10.0.0.1' } as unknown as ServerKitContext;

    // Exhaust the limit for the first IP
    await middleware(mockCtx, mockNext);
    await expect(middleware(mockCtx, mockNext)).rejects.toThrow();

    // Second IP should still be allowed
    let nextCalled = false;
    const next = (() => { nextCalled = true; return Promise.resolve(); }) as Next;
    await middleware(otherCtx, next);
    expect(nextCalled).toBe(true);
  });
});
