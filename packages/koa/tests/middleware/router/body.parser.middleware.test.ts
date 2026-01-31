import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bodyParserMiddleware } from '../../../src/middleware/router/body.parser.middleware.js';
import { httpError, HttpError } from '@maroonedsoftware/errors';
import { MultipartBody } from '@maroonedsoftware/multipart';
import coBody from 'co-body';
import rawBody from 'raw-body';
import type { ServerKitContext } from '../../../src/serverkit.context.js';
import type { Next } from 'koa';

// Mock dependencies
vi.mock('co-body');
vi.mock('raw-body');
vi.mock('@maroonedsoftware/multipart', () => ({
  MultipartBody: vi.fn(),
}));

describe('bodyParserMiddleware', () => {
  let mockCtx: ServerKitContext;
  let mockNext: Next;
  let mockReq: { length: number; headers: Record<string, string> };
  let mockRequest: {
    length: number;
    is: ReturnType<typeof vi.fn>;
    type: string;
  };

  beforeEach(() => {
    mockReq = {
      length: 0,
      headers: {},
    };

    mockRequest = {
      length: 0,
      is: vi.fn(),
      type: '',
    };

    mockNext = vi.fn().mockResolvedValue(undefined);

    mockCtx = {
      request: mockRequest as any,
      req: mockReq as any,
      body: undefined,
    } as unknown as ServerKitContext;

    vi.clearAllMocks();
  });

  describe('with empty contentTypes array', () => {
    it('should pass through when request has no body', async () => {
      const middleware = bodyParserMiddleware([]);
      mockRequest.length = 0;

      await middleware(mockCtx, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockCtx.body).toBeUndefined();
    });

    it('should throw 400 error when request has body', async () => {
      const middleware = bodyParserMiddleware([]);
      mockRequest.length = 100;

      await expect(middleware(mockCtx, mockNext)).rejects.toThrow();

      try {
        await middleware(mockCtx, mockNext);
      } catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        expect((error as HttpError).statusCode).toBe(400);
        expect((error as HttpError).details).toEqual({ body: 'Unexpected body' });
      }
      expect(mockNext).not.toHaveBeenCalled();
    });
  });

  describe('with contentTypes array', () => {
    describe('when request has no body', () => {
      it('should throw 411 error', async () => {
        const middleware = bodyParserMiddleware(['application/json']);
        mockRequest.length = 0;

        await expect(middleware(mockCtx, mockNext)).rejects.toThrow();

        try {
          await middleware(mockCtx, mockNext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpError);
          expect((error as HttpError).statusCode).toBe(411);
        }
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('content-type validation', () => {
      it('should throw 415 error when content-type does not match', async () => {
        const middleware = bodyParserMiddleware(['application/json']);
        mockRequest.length = 100;
        mockRequest.is.mockReturnValue(false);
        mockRequest.type = 'text/plain';

        await expect(middleware(mockCtx, mockNext)).rejects.toThrow();

        try {
          await middleware(mockCtx, mockNext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpError);
          expect((error as HttpError).statusCode).toBe(415);
          expect((error as HttpError).details).toEqual({
            'content-type': 'must be application/json',
            value: 'text/plain',
          });
        }
        expect(mockRequest.is).toHaveBeenCalledWith(['application/json']);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should format error message correctly for multiple content types', async () => {
        const middleware = bodyParserMiddleware(['application/json', 'application/xml']);
        mockRequest.length = 100;
        mockRequest.is.mockReturnValue(false);
        mockRequest.type = 'text/plain';

        await expect(middleware(mockCtx, mockNext)).rejects.toThrow();

        try {
          await middleware(mockCtx, mockNext);
        } catch (error) {
          expect((error as HttpError).details).toEqual({
            'content-type': 'must be one of application/json, application/xml',
            value: 'text/plain',
          });
        }
      });

      it('should pass when content-type matches', async () => {
        const middleware = bodyParserMiddleware(['application/json']);
        mockRequest.length = 100;
        mockRequest.is.mockImplementation((types: string | string[]) => {
          if (Array.isArray(types)) {
            // Content-type validation check
            if (types.includes('application/json')) return true;
          } else {
            // Specific type check
            if (types === 'json' || types === 'application/*+json') return true;
          }
          return false;
        });

        vi.mocked(coBody.json).mockResolvedValue({ key: 'value' });

        await middleware(mockCtx, mockNext);

        expect(mockNext).toHaveBeenCalledTimes(1);
      });
    });

    describe('JSON body parsing', () => {
      it('should parse JSON body', async () => {
        const middleware = bodyParserMiddleware(['application/json']);
        const jsonData = { name: 'test', value: 123 };
        mockRequest.length = 100;
        mockRequest.is.mockImplementation((types: string | string[]) => {
          if (Array.isArray(types)) {
            // Content-type validation check
            if (types.includes('application/json')) return true;
          } else {
            // Specific type check
            if (types === 'json' || types === 'application/*+json') return true;
          }
          return false;
        });

        vi.mocked(coBody.json).mockResolvedValue(jsonData);

        await middleware(mockCtx, mockNext);

        expect(coBody.json).toHaveBeenCalledWith(mockCtx);
        expect(mockCtx.body).toEqual(jsonData);
        expect(mockNext).toHaveBeenCalledTimes(1);
      });

      it('should parse application/*+json content types', async () => {
        const middleware = bodyParserMiddleware(['application/vnd.api+json']);
        const jsonData = { data: 'test' };
        mockRequest.length = 100;
        mockRequest.is.mockImplementation((types: string | string[]) => {
          if (Array.isArray(types)) {
            // Content-type validation check
            if (types.includes('application/vnd.api+json')) return true;
          } else {
            // Specific type check
            if (types === 'json' || types === 'application/*+json') return true;
          }
          return false;
        });

        vi.mocked(coBody.json).mockResolvedValue(jsonData);

        await middleware(mockCtx, mockNext);

        expect(coBody.json).toHaveBeenCalledWith(mockCtx);
        expect(mockCtx.body).toEqual(jsonData);
      });
    });

    describe('URL-encoded body parsing', () => {
      it('should parse urlencoded body', async () => {
        const middleware = bodyParserMiddleware(['application/x-www-form-urlencoded']);
        const formData = { field1: 'value1', field2: 'value2' };
        mockRequest.length = 100;
        mockRequest.is.mockImplementation((types: string | string[]) => {
          if (Array.isArray(types)) {
            // Content-type validation check
            if (types.includes('application/x-www-form-urlencoded')) return true;
          } else {
            // Specific type check
            if (types === 'urlencoded') return true;
          }
          return false;
        });

        vi.mocked(coBody.form).mockResolvedValue(formData);

        await middleware(mockCtx, mockNext);

        expect(coBody.form).toHaveBeenCalledWith(mockCtx);
        expect(mockCtx.body).toEqual(formData);
        expect(mockNext).toHaveBeenCalledTimes(1);
      });
    });

    describe('text body parsing', () => {
      it('should parse text/* body', async () => {
        const middleware = bodyParserMiddleware(['text/plain']);
        const textData = 'plain text content';
        mockRequest.length = 100;
        mockRequest.is.mockImplementation((types: string | string[]) => {
          if (Array.isArray(types)) {
            // Content-type validation check
            if (types.includes('text/plain')) return true;
          } else {
            // Specific type check
            if (types === 'text/*') return true;
          }
          return false;
        });

        vi.mocked(coBody.text).mockResolvedValue(textData);

        await middleware(mockCtx, mockNext);

        expect(coBody.text).toHaveBeenCalledWith(mockCtx);
        expect(mockCtx.body).toBe(textData);
        expect(mockNext).toHaveBeenCalledTimes(1);
      });
    });

    describe('multipart body parsing', () => {
      it('should create MultipartBody instance for multipart content', async () => {
        const middleware = bodyParserMiddleware(['multipart/form-data']);
        const mockMultipartBody = {} as MultipartBody;
        mockRequest.length = 100;
        mockRequest.is.mockImplementation((types: string | string[]) => {
          if (Array.isArray(types)) {
            // Content-type validation check
            if (types.includes('multipart/form-data')) return true;
          } else {
            // Specific type check
            if (types === 'multipart') return true;
          }
          return false;
        });

        vi.mocked(MultipartBody).mockImplementation(function (this: MultipartBody) {
          return mockMultipartBody;
        });

        await middleware(mockCtx, mockNext);

        expect(MultipartBody).toHaveBeenCalledWith(mockReq);
        expect(mockCtx.body).toBe(mockMultipartBody);
        expect(mockNext).toHaveBeenCalledTimes(1);
      });
    });

    describe('PDF body parsing', () => {
      it('should parse PDF body using raw-body', async () => {
        const middleware = bodyParserMiddleware(['application/pdf']);
        const pdfBuffer = Buffer.from('PDF content');
        mockRequest.length = 100;
        mockRequest.is.mockImplementation((types: string | string[]) => {
          if (Array.isArray(types)) {
            // Content-type validation check
            if (types.includes('application/pdf')) return true;
          } else {
            // Specific type check
            if (types === 'pdf') return true;
          }
          return false;
        });

        vi.mocked(rawBody).mockResolvedValue(pdfBuffer);

        await middleware(mockCtx, mockNext);

        expect(rawBody).toHaveBeenCalledWith(mockReq);
        expect(mockCtx.body).toBe(pdfBuffer);
        expect(mockNext).toHaveBeenCalledTimes(1);
      });
    });

    describe('unsupported media type', () => {
      it('should throw 422 error for unsupported content type', async () => {
        const middleware = bodyParserMiddleware(['application/json']);
        mockRequest.length = 100;
        mockRequest.is.mockImplementation((types: string[]) => {
          // Return true for content-type check, but false for all specific type checks
          if (Array.isArray(types) && types.includes('application/json')) return true;
          return false;
        });
        // Make all specific type checks return false
        mockRequest.is.mockImplementation((...args: unknown[]) => {
          const types = args[0];
          if (Array.isArray(types) && types.includes('application/json')) return true;
          if (types === 'json' || types === 'application/*+json') return false;
          if (types === 'urlencoded') return false;
          if (types === 'text/*') return false;
          if (types === 'multipart') return false;
          if (types === 'pdf') return false;
          return false;
        });

        await expect(middleware(mockCtx, mockNext)).rejects.toThrow();

        try {
          await middleware(mockCtx, mockNext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpError);
          expect((error as HttpError).statusCode).toBe(422);
          expect((error as HttpError).details).toEqual({ body: 'Unsupported media type' });
        }
        expect(mockNext).not.toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should re-throw HttpError from parsing', async () => {
        const middleware = bodyParserMiddleware(['application/json']);
        const httpErr = httpError(400).withDetails({ field: 'invalid' });
        mockRequest.length = 100;
        mockRequest.is.mockImplementation((types: string[]) => {
          if (types.includes('application/json')) return true;
          if (types.includes('json') || types.includes('application/*+json')) return true;
          return false;
        });

        vi.mocked(coBody.json).mockRejectedValue(httpErr);

        await expect(middleware(mockCtx, mockNext)).rejects.toBe(httpErr);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should wrap non-HttpError in 422 error', async () => {
        const middleware = bodyParserMiddleware(['application/json']);
        const parseError = new Error('Parse failed');
        mockRequest.length = 100;
        mockRequest.is.mockImplementation((types: string[]) => {
          if (types.includes('application/json')) return true;
          if (types.includes('json') || types.includes('application/*+json')) return true;
          return false;
        });

        vi.mocked(coBody.json).mockRejectedValue(parseError);

        await expect(middleware(mockCtx, mockNext)).rejects.toThrow();

        try {
          await middleware(mockCtx, mockNext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpError);
          expect((error as HttpError).statusCode).toBe(422);
          expect((error as HttpError).details).toEqual({ body: 'Invalid request body format' });
          expect((error as HttpError).cause).toBe(parseError);
        }
        expect(mockNext).not.toHaveBeenCalled();
      });
    });
  });
});
