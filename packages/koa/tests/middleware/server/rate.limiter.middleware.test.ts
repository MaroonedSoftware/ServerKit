import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rateLimiterMiddleware } from '../../../src/middleware/server/rate.limiter.middleware.js';
import type { ServerKitContext } from '../../../src/serverkit.context.js';
import type { Next } from 'koa';
import type { RateLimiterAbstract } from 'rate-limiter-flexible';
import { IsHttpError } from '@maroonedsoftware/errors';

describe('rateLimiterMiddleware', () => {
  let mockCtx: ServerKitContext;
  let mockNext: Next;
  let mockRateLimiter: { consume: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockNext = vi.fn().mockResolvedValue(undefined);
    mockCtx = {
      ip: '192.168.1.1',
    } as unknown as ServerKitContext;
    mockRateLimiter = {
      consume: vi.fn().mockResolvedValue(undefined),
    };
    vi.clearAllMocks();
  });

  it('should return a middleware function', () => {
    const middleware = rateLimiterMiddleware(mockRateLimiter as unknown as RateLimiterAbstract);

    expect(middleware).toBeTypeOf('function');
    expect(middleware.length).toBe(2);
  });

  it('should call rateLimiter.consume with ctx.ip', async () => {
    const middleware = rateLimiterMiddleware(mockRateLimiter as unknown as RateLimiterAbstract);

    await middleware(mockCtx, mockNext);

    expect(mockRateLimiter.consume).toHaveBeenCalledTimes(1);
    expect(mockRateLimiter.consume).toHaveBeenCalledWith('192.168.1.1');
  });

  it('should call next() when consume succeeds', async () => {
    const middleware = rateLimiterMiddleware(mockRateLimiter as unknown as RateLimiterAbstract);

    await middleware(mockCtx, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('should throw 429 HttpError when consume rejects', async () => {
    const rateLimitError = new Error('Rate limit exceeded');
    mockRateLimiter.consume.mockRejectedValue(rateLimitError);
    const middleware = rateLimiterMiddleware(mockRateLimiter as unknown as RateLimiterAbstract);

    let caught: unknown;
    try {
      await middleware(mockCtx, mockNext);
    } catch (e) {
      caught = e;
    }
    expect(IsHttpError(caught)).toBe(true);
    expect((caught as { statusCode: number }).statusCode).toBe(429);
    expect((caught as { cause: Error }).cause).toBe(rateLimitError);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should not call next when consume rejects', async () => {
    mockRateLimiter.consume.mockRejectedValue(new Error('Limit exceeded'));
    const middleware = rateLimiterMiddleware(mockRateLimiter as unknown as RateLimiterAbstract);

    await expect(middleware(mockCtx, mockNext)).rejects.toThrow();
    expect(mockNext).not.toHaveBeenCalled();
  });
});
