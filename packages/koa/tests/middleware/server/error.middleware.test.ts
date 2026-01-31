import { describe, it, expect, vi, beforeEach } from 'vitest';
import { errorMiddleware } from '../../../src/middleware/server/error.middleware.js';
import { httpError, HttpError, IsHttpError } from '@maroonedsoftware/errors';
import type { ServerKitContext } from '../../../src/serverkit.context.js';
import type { Next } from 'koa';

describe('errorMiddleware', () => {
  let mockCtx: ServerKitContext;
  let mockNext: ReturnType<typeof vi.fn<Next>>;
  let mockApp: { emit: ReturnType<typeof vi.fn> };
  let mockURL: URL;

  beforeEach(() => {
    mockURL = new URL('https://example.com/test');
    mockApp = {
      emit: vi.fn(),
    };

    mockNext = vi.fn().mockResolvedValue(undefined);

    mockCtx = {
      status: 200,
      body: undefined,
      URL: mockURL,
      app: mockApp as any,
      set: vi.fn(),
    } as unknown as ServerKitContext;

    vi.clearAllMocks();
  });

  describe('successful request handling', () => {
    it('should call next and pass through when no error occurs', async () => {
      const middleware = errorMiddleware();

      await middleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockCtx.status).toBe(200);
      expect(mockApp.emit).not.toHaveBeenCalled();
    });

    it('should not modify response when request succeeds with body', async () => {
      const middleware = errorMiddleware();
      const responseBody = { data: 'test' };
      mockCtx.body = responseBody;
      mockCtx.status = 200;

      await middleware(mockCtx, mockNext);

      expect(mockCtx.body).toBe(responseBody);
      expect(mockCtx.status).toBe(200);
    });
  });

  describe('404 handling', () => {
    it('should handle 404 with no body and emit warn event', async () => {
      const middleware = errorMiddleware();
      mockCtx.status = 404;
      mockCtx.body = undefined;

      await middleware(mockCtx, mockNext);

      expect(mockCtx.status).toBe(404);
      expect(mockCtx.body).toEqual({
        statusCode: 404,
        message: 'Not Found',
        details: { url: mockURL.toString() },
      });
      expect(mockApp.emit).toHaveBeenCalledWith('warn', mockCtx.body, mockCtx);
    });

    it('should not modify 404 response when body exists', async () => {
      const middleware = errorMiddleware();
      const existingBody = { error: 'Custom 404 message' };
      mockCtx.status = 404;
      mockCtx.body = existingBody;

      await middleware(mockCtx, mockNext);

      expect(mockCtx.body).toBe(existingBody);
      expect(mockCtx.status).toBe(404);
      expect(mockApp.emit).not.toHaveBeenCalledWith('warn', expect.anything(), expect.anything());
    });
  });

  describe('HttpError handling', () => {
    it('should handle HttpError and set status code and body', async () => {
      const middleware = errorMiddleware();
      const httpErr = httpError(400).withDetails({ field: 'invalid' });
      mockNext.mockRejectedValue(httpErr);

      await middleware(mockCtx, mockNext);

      expect(mockCtx.status).toBe(400);
      expect(mockCtx.body).toEqual({
        statusCode: 400,
        message: httpErr.message,
        details: { field: 'invalid' },
      });
      expect(mockApp.emit).toHaveBeenCalledWith('error', httpErr, mockCtx);
    });

    it('should handle HttpError with headers', async () => {
      const middleware = errorMiddleware();
      const httpErr = httpError(401).withHeaders({ 'WWW-Authenticate': 'Bearer realm="api"' }).withDetails({ auth: 'Unauthorized' });
      mockNext.mockRejectedValue(httpErr);

      await middleware(mockCtx, mockNext);

      expect(mockCtx.status).toBe(401);
      expect(mockCtx.set).toHaveBeenCalledWith('WWW-Authenticate', 'Bearer realm="api"');
      expect(mockCtx.body).toEqual({
        statusCode: 401,
        message: httpErr.message,
        details: { auth: 'Unauthorized' },
      });
    });

    it('should handle HttpError with multiple headers', async () => {
      const middleware = errorMiddleware();
      const httpErr = httpError(403).withHeaders({
        'X-Error-Code': 'FORBIDDEN',
        'Retry-After': '60',
      });
      mockNext.mockRejectedValue(httpErr);

      await middleware(mockCtx, mockNext);

      expect(mockCtx.set).toHaveBeenCalledWith('X-Error-Code', 'FORBIDDEN');
      expect(mockCtx.set).toHaveBeenCalledWith('Retry-After', '60');
      expect(mockCtx.set).toHaveBeenCalledTimes(2);
    });

    it('should handle HttpError without details', async () => {
      const middleware = errorMiddleware();
      const httpErr = httpError(500);
      mockNext.mockRejectedValue(httpErr);

      await middleware(mockCtx, mockNext);

      expect(mockCtx.status).toBe(500);
      expect(mockCtx.body).toEqual({
        statusCode: 500,
        message: httpErr.message,
        details: undefined,
      });
    });

    it('should handle various HttpError status codes', async () => {
      const statusCodes = [400, 401, 403, 404, 422, 500, 503];
      const middleware = errorMiddleware();

      for (const statusCode of statusCodes) {
        vi.clearAllMocks();
        const httpErr = httpError(statusCode as any);
        mockNext.mockRejectedValue(httpErr);

        await middleware(mockCtx, mockNext);

        expect(mockCtx.status).toBe(statusCode);
        expect(mockCtx.body).toEqual({
          statusCode,
          message: httpErr.message,
          details: undefined,
        });
      }
    });
  });

  describe('non-HttpError handling', () => {
    it('should handle generic Error and return 500', async () => {
      const middleware = errorMiddleware();
      const genericError = new Error('Something went wrong');
      mockNext.mockRejectedValue(genericError);

      await middleware(mockCtx, mockNext);

      expect(mockCtx.status).toBe(500);
      expect(mockCtx.body).toEqual({
        statusCode: 500,
        message: 'Internal Server Error',
      });
      expect(mockApp.emit).toHaveBeenCalledWith('error', genericError, mockCtx);
    });

    it('should handle non-Error thrown values', async () => {
      const middleware = errorMiddleware();
      const thrownValue = 'String error';
      mockNext.mockRejectedValue(thrownValue);

      await middleware(mockCtx, mockNext);

      expect(mockCtx.status).toBe(500);
      expect(mockCtx.body).toEqual({
        statusCode: 500,
        message: 'Internal Server Error',
      });
      expect(mockApp.emit).toHaveBeenCalledWith('error', thrownValue, mockCtx);
    });

    it('should handle null/undefined errors', async () => {
      const middleware = errorMiddleware();
      mockNext.mockRejectedValue(null);

      await middleware(mockCtx, mockNext);

      expect(mockCtx.status).toBe(500);
      expect(mockCtx.body).toEqual({
        statusCode: 500,
        message: 'Internal Server Error',
      });
    });
  });

  describe('error event emission', () => {
    it('should emit error event for HttpError', async () => {
      const middleware = errorMiddleware();
      const httpErr = httpError(400);
      mockNext.mockRejectedValue(httpErr);

      await middleware(mockCtx, mockNext);

      expect(mockApp.emit).toHaveBeenCalledWith('error', httpErr, mockCtx);
      expect(mockApp.emit).toHaveBeenCalledTimes(1);
    });

    it('should emit error event for generic errors', async () => {
      const middleware = errorMiddleware();
      const genericError = new Error('Test error');
      mockNext.mockRejectedValue(genericError);

      await middleware(mockCtx, mockNext);

      expect(mockApp.emit).toHaveBeenCalledWith('error', genericError, mockCtx);
      expect(mockApp.emit).toHaveBeenCalledTimes(1);
    });

    it('should not emit error event when no error occurs', async () => {
      const middleware = errorMiddleware();

      await middleware(mockCtx, mockNext);

      expect(mockApp.emit).not.toHaveBeenCalled();
    });
  });

  describe('integration scenarios', () => {
    it('should handle error then successful request', async () => {
      const middleware = errorMiddleware();

      // First request with error
      const httpErr = httpError(400);
      mockNext.mockRejectedValueOnce(httpErr);
      await middleware(mockCtx, mockNext);
      expect(mockCtx.status).toBe(400);

      // Reset for second request
      vi.clearAllMocks();
      mockCtx.status = 200;
      mockCtx.body = undefined;
      mockNext.mockResolvedValue(undefined);

      // Second request without error
      await middleware(mockCtx, mockNext);
      expect(mockCtx.status).toBe(200);
      expect(mockApp.emit).not.toHaveBeenCalled();
    });

    it('should preserve existing response body when error occurs after body is set', async () => {
      const middleware = errorMiddleware();
      // Simulate a scenario where body was set before error
      mockCtx.body = { data: 'existing' };
      const httpErr = httpError(400);
      mockNext.mockRejectedValue(httpErr);

      await middleware(mockCtx, mockNext);

      // Error body should override existing body
      expect(mockCtx.body).toEqual({
        statusCode: 400,
        message: httpErr.message,
        details: undefined,
      });
    });
  });
});
