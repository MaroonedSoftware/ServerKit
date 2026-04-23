import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeSecurityMiddleware } from '../../../src/middleware/server/fake.security.middleware.js';
import type { ServerKitContext } from '../../../src/serverkit.context.js';
import type { Next } from 'koa';

describe('fakeSecurityMiddleware', () => {
  let mockCtx: ServerKitContext;
  let mockNext: Next;

  beforeEach(() => {
    mockNext = vi.fn().mockResolvedValue(undefined);
    mockCtx = {
      logger: { warn: vi.fn() },
      req: { headers: {} },
    } as unknown as ServerKitContext;
  });

  it('returns a middleware function', () => {
    expect(fakeSecurityMiddleware('token')).toBeTypeOf('function');
  });

  it('always calls next()', async () => {
    await fakeSecurityMiddleware('Bearer fake')(mockCtx, mockNext);
    expect(mockNext).toHaveBeenCalledOnce();
  });

  it('always logs a warning', async () => {
    await fakeSecurityMiddleware('Bearer fake')(mockCtx, mockNext);
    expect(mockCtx.logger.warn).toHaveBeenCalledOnce();
  });

  describe('when Authorization header is absent', () => {
    it('sets the Authorization header to the provided token', async () => {
      const token = 'Bearer my-fake-token';
      await fakeSecurityMiddleware(token)(mockCtx, mockNext);
      expect(mockCtx.req.headers.authorization).toBe(token);
    });

    it('calls next() after setting the header', async () => {
      await fakeSecurityMiddleware('Bearer fake')(mockCtx, mockNext);
      expect(mockCtx.req.headers.authorization).toBeDefined();
      expect(mockNext).toHaveBeenCalledOnce();
    });
  });

  describe('when Authorization header is already present', () => {
    it('does not override the existing Authorization header', async () => {
      const existing = 'Bearer existing-token';
      mockCtx.req.headers.authorization = existing;
      await fakeSecurityMiddleware('Bearer fake')(mockCtx, mockNext);
      expect(mockCtx.req.headers.authorization).toBe(existing);
    });

    it('still calls next()', async () => {
      mockCtx.req.headers.authorization = 'Bearer existing-token';
      await fakeSecurityMiddleware('Bearer fake')(mockCtx, mockNext);
      expect(mockNext).toHaveBeenCalledOnce();
    });

    it('still logs a warning', async () => {
      mockCtx.req.headers.authorization = 'Bearer existing-token';
      await fakeSecurityMiddleware('Bearer fake')(mockCtx, mockNext);
      expect(mockCtx.logger.warn).toHaveBeenCalledOnce();
    });
  });
});
