import { describe, it, expect, vi, beforeEach } from 'vitest';
import { corsMiddleware } from '../../../src/middleware/server/cors.middleware.js';
import type { ServerKitContext } from '../../../src/serverkit.context.js';
import type { Next } from 'koa';
import type { Context } from 'koa';

vi.mock('@koa/cors', () => ({
  default: vi.fn((options: { origin?: (ctx: Context) => string }) => {
    return async (_ctx: Context, next: Next) => {
      await next();
    };
  }),
}));

describe('corsMiddleware', () => {
  let mockCtx: ServerKitContext;
  let mockNext: Next;

  beforeEach(async () => {
    const cors = (await import('@koa/cors')).default;
    vi.mocked(cors).mockClear();

    mockNext = vi.fn().mockResolvedValue(undefined);
    mockCtx = {
      get: vi.fn(),
    } as unknown as ServerKitContext;
    vi.clearAllMocks();
  });

  it('should return a middleware function', () => {
    const middleware = corsMiddleware();

    expect(middleware).toBeTypeOf('function');
    expect(middleware.length).toBe(2);
  });

  it('should call @koa/cors with default options when no options provided', async () => {
    const cors = (await import('@koa/cors')).default;
    corsMiddleware();

    expect(vi.mocked(cors)).toHaveBeenCalledWith(
      expect.objectContaining({
        allowMethods: 'GET,HEAD,PUT,POST,DELETE,PATCH',
        secureContext: false,
        keepHeadersOnError: false,
        privateNetworkAccess: false,
      }),
    );
    expect(vi.mocked(cors)).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: expect.any(Function),
      }),
    );
  });

  it('should pass custom options to @koa/cors', async () => {
    const cors = (await import('@koa/cors')).default;
    corsMiddleware({
      allowMethods: 'GET,POST',
      secureContext: true,
    });

    expect(vi.mocked(cors)).toHaveBeenCalledWith(
      expect.objectContaining({
        allowMethods: 'GET,POST',
        secureContext: true,
      }),
    );
  });

  describe('origin matcher', () => {
    const getOriginMatcher = async () => {
      const cors = (await import('@koa/cors')).default;
      corsMiddleware();
      const call = vi.mocked(cors).mock.calls[0]?.[0];
      expect(call).toBeDefined();
      return (call as { origin: (ctx: Context) => string }).origin;
    };

    it('should return request origin when matcher is *', async () => {
      const matcher = await getOriginMatcher();
      vi.mocked(mockCtx.get).mockReturnValue('https://example.com');

      const result = matcher(mockCtx as Context);

      expect(result).toBe('https://example.com');
    });

    it('should return origin when string matcher matches', async () => {
      const cors = (await import('@koa/cors')).default;
      corsMiddleware({ origin: ['https://api.example.com'] });
      const call = vi.mocked(cors).mock.calls[0]?.[0];
      expect(call).toBeDefined();
      const matcher = (call as { origin: (ctx: Context) => string }).origin;

      vi.mocked(mockCtx.get).mockReturnValue('https://api.example.com');

      const result = matcher(mockCtx as Context);

      expect(result).toBe('https://api.example.com');
    });

    it('should return empty string when string matcher does not match', async () => {
      const cors = (await import('@koa/cors')).default;
      corsMiddleware({ origin: ['https://api.example.com'] });
      const call = vi.mocked(cors).mock.calls[0]?.[0];
      expect(call).toBeDefined();
      const matcher = (call as { origin: (ctx: Context) => string }).origin;

      vi.mocked(mockCtx.get).mockReturnValue('https://other.com');

      const result = matcher(mockCtx as Context);

      expect(result).toBe('');
    });

    it('should return origin when RegExp matcher matches', async () => {
      const cors = (await import('@koa/cors')).default;
      corsMiddleware({ origin: [/^https:\/\/.*\.example\.com$/] });
      const call = vi.mocked(cors).mock.calls[0]?.[0];
      expect(call).toBeDefined();
      const matcher = (call as { origin: (ctx: Context) => string }).origin;

      vi.mocked(mockCtx.get).mockReturnValue('https://app.example.com');

      const result = matcher(mockCtx as Context);

      expect(result).toBe('https://app.example.com');
    });

    it('should return empty string when RegExp matcher does not match', async () => {
      const cors = (await import('@koa/cors')).default;
      corsMiddleware({ origin: [/^https:\/\/.*\.example\.com$/] });
      const call = vi.mocked(cors).mock.calls[0]?.[0];
      expect(call).toBeDefined();
      const matcher = (call as { origin: (ctx: Context) => string }).origin;

      vi.mocked(mockCtx.get).mockReturnValue('https://other.com');

      const result = matcher(mockCtx as Context);

      expect(result).toBe('');
    });

    it('should try multiple matchers and return first match', async () => {
      const cors = (await import('@koa/cors')).default;
      corsMiddleware({
        origin: ['https://a.com', /^https:\/\/b\.com$/, 'https://c.com'],
      });
      const call = vi.mocked(cors).mock.calls[0]?.[0];
      expect(call).toBeDefined();
      const matcher = (call as { origin: (ctx: Context) => string }).origin;

      vi.mocked(mockCtx.get).mockReturnValue('https://b.com');

      const result = matcher(mockCtx as Context);

      expect(result).toBe('https://b.com');
    });
  });

  it('should invoke returned middleware and call next', async () => {
    const middleware = corsMiddleware();

    await middleware(mockCtx, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
  });
});
