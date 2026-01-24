import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectkitMiddleware } from '../../../src/middleware/server/injectkit.middleware.js';
import type { Container } from 'injectkit';
import type { Logger } from '@maroonedsoftware/logger';
import type { ServerKitContext } from '../../../src/serverkit.context.js';
import type { Next } from 'koa';

describe('injectkitMiddleware', () => {
  let mockCtx: ServerKitContext;
  let mockNext: Next;
  let mockContainer: Container;
  let mockScopedContainer: Container;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    } as unknown as Logger;

    mockScopedContainer = {
      get: vi.fn(),
      createScopedContainer: vi.fn(),
    } as unknown as Container;

    mockContainer = {
      get: vi.fn().mockReturnValue(mockLogger),
      createScopedContainer: vi.fn().mockReturnValue(mockScopedContainer),
    } as unknown as Container;

    mockNext = vi.fn().mockResolvedValue(undefined);

    mockCtx = {
      container: undefined as any,
      logger: undefined as any,
    } as unknown as ServerKitContext;

    vi.clearAllMocks();
  });

  describe('container setup', () => {
    it('should create scoped container and attach to context', async () => {
      const middleware = injectkitMiddleware(mockContainer);

      await middleware(mockCtx, mockNext);

      expect(mockContainer.createScopedContainer).toHaveBeenCalledTimes(1);
      expect(mockCtx.container).toBe(mockScopedContainer);
    });

    it('should create new scoped container for each request', async () => {
      const middleware = injectkitMiddleware(mockContainer);
      const secondScopedContainer = {} as Container;
      mockContainer.createScopedContainer.mockReturnValueOnce(mockScopedContainer).mockReturnValueOnce(secondScopedContainer);

      // First request
      await middleware(mockCtx, mockNext);
      expect(mockCtx.container).toBe(mockScopedContainer);

      // Second request
      await middleware(mockCtx, mockNext);
      expect(mockCtx.container).toBe(secondScopedContainer);
      expect(mockContainer.createScopedContainer).toHaveBeenCalledTimes(2);
    });
  });

  describe('logger setup', () => {
    it('should get logger from container and attach to context', async () => {
      const middleware = injectkitMiddleware(mockContainer);

      await middleware(mockCtx, mockNext);

      expect(mockContainer.get).toHaveBeenCalledTimes(1);
      expect(mockContainer.get).toHaveBeenCalledWith(expect.any(Function));
      expect(mockCtx.logger).toBe(mockLogger);
    });

    it('should get logger from root container, not scoped container', async () => {
      const middleware = injectkitMiddleware(mockContainer);

      await middleware(mockCtx, mockNext);

      // Should call get on root container, not scoped container
      expect(mockContainer.get).toHaveBeenCalled();
      expect(mockScopedContainer.get).not.toHaveBeenCalled();
    });
  });

  describe('middleware execution', () => {
    it('should call next middleware', async () => {
      const middleware = injectkitMiddleware(mockContainer);

      await middleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('should call next with context', async () => {
      const middleware = injectkitMiddleware(mockContainer);

      await middleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('should await next middleware', async () => {
      const middleware = injectkitMiddleware(mockContainer);
      let nextCalled = false;
      mockNext.mockImplementation(async () => {
        nextCalled = true;
      });

      await middleware(mockCtx, mockNext);

      expect(nextCalled).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should set container and logger before calling next', async () => {
      const middleware = injectkitMiddleware(mockContainer);
      const error = new Error('Test error');
      mockNext.mockRejectedValue(error);

      await expect(middleware(mockCtx, mockNext)).rejects.toThrow('Test error');

      // Container and logger should be set even if next throws
      expect(mockCtx.container).toBe(mockScopedContainer);
      expect(mockCtx.logger).toBe(mockLogger);
    });

    it('should propagate errors from next middleware', async () => {
      const middleware = injectkitMiddleware(mockContainer);
      const error = new Error('Middleware error');
      mockNext.mockRejectedValue(error);

      await expect(middleware(mockCtx, mockNext)).rejects.toThrow('Middleware error');
    });
  });

  describe('multiple requests', () => {
    it('should handle multiple sequential requests', async () => {
      const middleware = injectkitMiddleware(mockContainer);

      // First request
      await middleware(mockCtx, mockNext);
      const firstContainer = mockCtx.container;
      const firstLogger = mockCtx.logger;

      // Second request
      const secondScopedContainer = {} as Container;
      mockContainer.createScopedContainer.mockReturnValueOnce(secondScopedContainer);
      await middleware(mockCtx, mockNext);

      expect(mockCtx.container).toBe(secondScopedContainer);
      expect(mockCtx.logger).toBe(mockLogger); // Same logger instance
      expect(mockContainer.createScopedContainer).toHaveBeenCalledTimes(2);
    });
  });

  describe('container and logger availability', () => {
    it('should make container available in context before next is called', async () => {
      const middleware = injectkitMiddleware(mockContainer);
      let containerAvailable = false;

      mockNext.mockImplementation(async () => {
        containerAvailable = mockCtx.container !== undefined;
      });

      await middleware(mockCtx, mockNext);

      expect(containerAvailable).toBe(true);
      expect(mockCtx.container).toBe(mockScopedContainer);
    });

    it('should make logger available in context before next is called', async () => {
      const middleware = injectkitMiddleware(mockContainer);
      let loggerAvailable = false;

      mockNext.mockImplementation(async () => {
        loggerAvailable = mockCtx.logger !== undefined;
      });

      await middleware(mockCtx, mockNext);

      expect(loggerAvailable).toBe(true);
      expect(mockCtx.logger).toBe(mockLogger);
    });
  });
});
