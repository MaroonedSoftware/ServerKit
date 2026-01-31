import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import { serverKitContextMiddleware } from '../../../src/middleware/server/serverkit.context.middleware.js';
import type { ServerKitContext } from '../../../src/serverkit.context.js';
import type { Next } from 'koa';
import type { Container } from 'injectkit';
import type { Logger } from '@maroonedsoftware/logger';

describe('serverKitContextMiddleware', () => {
  let mockCtx: ServerKitContext;
  let mockNext: Next;
  let mockContainer: {
    createScopedContainer: Mock;
    get: Mock;
  };
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {} as Logger;
    mockContainer = {
      createScopedContainer: vi.fn().mockReturnValue({}),
      get: vi.fn().mockReturnValue(mockLogger),
    };
    mockNext = vi.fn().mockResolvedValue(undefined);
    mockCtx = {
      path: '/api/example',
      get: vi.fn(),
      set: vi.fn(),
      headers: {} as Record<string, string>,
    } as unknown as ServerKitContext;
  });

  it('should return a middleware function', () => {
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    expect(middleware).toBeTypeOf('function');
    expect(middleware.length).toBe(2);
  });

  it('should set ctx.container from container.createScopedContainer()', async () => {
    const scopedContainer = { scope: 'request' };
    mockContainer.createScopedContainer.mockReturnValue(scopedContainer);
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockContainer.createScopedContainer).toHaveBeenCalledTimes(1);
    expect(mockCtx.container).toBe(scopedContainer);
  });

  it('should set ctx.logger from container.get(Logger)', async () => {
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockContainer.get).toHaveBeenCalledWith(expect.anything());
    expect(mockCtx.logger).toBe(mockLogger);
  });

  it('should set ctx.loggerName to ctx.path', async () => {
    mockCtx.path = '/api/users';
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockCtx.loggerName).toBe('/api/users');
  });

  it('should set ctx.userAgent from user-agent header when present', async () => {
    vi.mocked(mockCtx.get).mockImplementation((name: string) =>
      name === 'user-agent' ? 'Mozilla/5.0' : '',
    );
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
    vi.mocked(mockCtx.get).mockImplementation((name: string) =>
      name === 'x-correlation-id' ? correlationId : '',
    );
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
    expect(mockCtx.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('should set ctx.requestId from x-request-id header when present', async () => {
    const requestId = 'req-456';
    vi.mocked(mockCtx.get).mockImplementation((name: string) =>
      name === 'x-request-id' ? requestId : '',
    );
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockCtx.requestId).toBe(requestId);
  });

  it('should set ctx.requestId to new UUID when header absent', async () => {
    // Koa ctx.get() returns undefined when header is absent; ?? then uses crypto.randomUUID()
    vi.mocked(mockCtx.get as (name: string) => string | undefined).mockReturnValue(undefined);
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockCtx.requestId).toBeDefined();
    expect(mockCtx.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('should set x-correlation-id header on response', async () => {
    const correlationId = 'corr-789';
    vi.mocked(mockCtx.get).mockImplementation((name: string) =>
      name === 'x-correlation-id' ? correlationId : '',
    );
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockCtx.headers['x-correlation-id']).toBe(correlationId);
    expect(mockCtx.set).toHaveBeenCalledWith('x-correlation-id', correlationId);
  });

  it('should set x-request-id header on response', async () => {
    const requestId = 'req-abc';
    vi.mocked(mockCtx.get).mockImplementation((name: string) =>
      name === 'x-request-id' ? requestId : '',
    );
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockCtx.headers['x-request-id']).toBe(requestId);
    expect(mockCtx.set).toHaveBeenCalledWith('x-request-id', requestId);
  });

  it('should call next()', async () => {
    const middleware = serverKitContextMiddleware(mockContainer as unknown as Container);

    await middleware(mockCtx, mockNext);

    expect(mockNext).toHaveBeenCalledTimes(1);
  });
});
