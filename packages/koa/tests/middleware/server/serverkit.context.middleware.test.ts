import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { serverKitContextMiddleware } from '../../../src/middleware/server/serverkit.context.middleware.js';
import { ServerKitContext } from '../../../src/serverkit.context.js';
import type { Next } from 'koa';
import type { Container } from 'injectkit';
import type { Logger } from '@maroonedsoftware/logger';

describe('serverKitContextMiddleware', () => {
  let mockCtx: ServerKitContext;
  let mockNext: Next;
  let mockScopedContainer: {
    get: Mock;
    override: Mock;
    disposeAsync: Mock;
  };
  let mockContainer: {
    createScopedContainer: Mock;
  };
  let mockLogger: Logger;
  let mockRes: { once: Mock };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = { error: vi.fn() } as unknown as Logger;
    mockScopedContainer = {
      get: vi.fn().mockReturnValue(mockLogger),
      override: vi.fn(),
      disposeAsync: vi.fn().mockResolvedValue(undefined),
    };
    mockContainer = {
      createScopedContainer: vi.fn().mockReturnValue(mockScopedContainer),
    };
    mockNext = vi.fn().mockResolvedValue(undefined);
    mockRes = { once: vi.fn() };
    mockCtx = {
      path: '/api/example',
      get: vi.fn(),
      set: vi.fn(),
      headers: {} as Record<string, string>,
      res: mockRes,
    } as unknown as ServerKitContext;
  });

  /** The 'close' listener the middleware registered on ctx.res, for tests to fire by hand. */
  const closeListener = (): (() => void) => {
    const call = mockRes.once.mock.calls.find(([event]) => event === 'close');
    expect(call).toBeDefined();
    return call![1] as () => void;
  };

  it('should return a middleware function', () => {
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    expect(middleware).toBeTypeOf('function');
    expect(middleware.length).toBe(2);
  });

  it('should set ctx.container from container.createScopedContainer()', async () => {
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockContainer.createScopedContainer).toHaveBeenCalledTimes(1);
    expect(mockCtx.container).toBe(mockScopedContainer);
  });

  it('should register the live ctx against ServerKitContext on the scoped container', async () => {
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockScopedContainer.override).toHaveBeenCalledWith(ServerKitContext, mockCtx);
  });

  it('should resolve ctx.logger from the scoped container', async () => {
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockScopedContainer.get).toHaveBeenCalledWith(expect.anything());
    expect(mockCtx.logger).toBe(mockLogger);
  });

  it('should set ctx.loggerName to ctx.path', async () => {
    mockCtx.path = '/api/users';
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockCtx.loggerName).toBe('/api/users');
  });

  it('should set ctx.userAgent from user-agent header when present', async () => {
    vi.mocked(mockCtx.get).mockImplementation((name: string) => (name === 'user-agent' ? 'Mozilla/5.0' : ''));
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockCtx.userAgent).toBe('Mozilla/5.0');
  });

  it('should set ctx.userAgent to empty string when user-agent header absent', async () => {
    vi.mocked(mockCtx.get).mockReturnValue('');
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockCtx.userAgent).toBe('');
  });

  it('should set ctx.correlationId from x-correlation-id header when present', async () => {
    const correlationId = 'corr-123';
    mockCtx.headers['x-correlation-id'] = correlationId;
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockCtx.correlationId).toBe(correlationId);
  });

  it('should set ctx.correlationId to new UUID when header absent', async () => {
    // Koa ctx.get() returns undefined when header is absent; ?? then uses crypto.randomUUID()
    vi.mocked(mockCtx.get as (name: string) => string | undefined).mockReturnValue(undefined);
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockCtx.correlationId).toBeDefined();
    expect(mockCtx.correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('should preserve an inbound x-request-id header', async () => {
    const requestId = 'req-456';
    mockCtx.headers['x-request-id'] = requestId;
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockCtx.requestId).toBe(requestId);
    expect(mockCtx.set).toHaveBeenCalledWith('x-request-id', requestId);
  });

  it('should use the first value when x-request-id header is an array', async () => {
    (mockCtx.headers as Record<string, string | string[]>)['x-request-id'] = ['req-first', 'req-second'];
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockCtx.requestId).toBe('req-first');
  });

  it('should set ctx.requestId to new UUID when header absent', async () => {
    // Koa ctx.get() returns undefined when header is absent; ?? then uses crypto.randomUUID()
    vi.mocked(mockCtx.get as (name: string) => string | undefined).mockReturnValue(undefined);
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockCtx.requestId).toBeDefined();
    expect(mockCtx.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('should set x-correlation-id header on response', async () => {
    const correlationId = 'corr-789';
    mockCtx.headers['x-correlation-id'] = correlationId;
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockCtx.headers['x-correlation-id']).toBe(correlationId);
    expect(mockCtx.set).toHaveBeenCalledWith('x-correlation-id', correlationId);
  });

  it('should set x-request-id header on response to a generated UUID', async () => {
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockCtx.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(mockCtx.set).toHaveBeenCalledWith('x-request-id', mockCtx.headers['x-request-id']);
  });

  it('should call next()', async () => {
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
  });

  it('should register exactly one close listener on ctx.res', async () => {
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockRes.once).toHaveBeenCalledTimes(1);
    expect(mockRes.once).toHaveBeenCalledWith('close', expect.any(Function));
  });

  it('should not dispose the scoped container before the response closes', async () => {
    // SSE/serverfeed handlers return while the response stays open, so disposal must be
    // driven by the response closing, never by next() unwinding.
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockScopedContainer.disposeAsync).not.toHaveBeenCalled();
  });

  it('should dispose the scoped container when the response closes', async () => {
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);
    closeListener()();

    expect(mockScopedContainer.disposeAsync).toHaveBeenCalledTimes(1);
  });

  it('should log a disposal failure instead of letting it reject unhandled', async () => {
    // The response is already gone when disposal runs, so a failure has no request to fail —
    // it must land on the logger. An unhandled rejection here would fail the vitest run.
    mockScopedContainer.disposeAsync.mockRejectedValue(new Error('teardown failed'));
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);
    closeListener()();
    await new Promise(resolve => setImmediate(resolve));

    expect(mockLogger.error).toHaveBeenCalledWith(expect.objectContaining({ message: 'teardown failed' }));
  });
});
