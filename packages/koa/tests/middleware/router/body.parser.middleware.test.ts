import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { bodyParserMiddleware } from '../../../src/middleware/router/body.parser.middleware.js';
import { httpError, HttpError } from '@maroonedsoftware/errors';
import { ServerKitBodyParser } from '../../../src/serverkit.bodyparser.js';
import type { ServerKitContext } from '../../../src/serverkit.context.js';
import type { Next } from 'koa';

describe('bodyParserMiddleware', () => {
  let mockCtx: ServerKitContext;
  let mockNext: Next;
  let mockBodyParser: { parse: Mock };
  let mockContainer: { get: Mock };
  let mockRequest: {
    length: number;
    is: ReturnType<typeof vi.fn>;
    type: string;
  };

  beforeEach(() => {
    mockBodyParser = { parse: vi.fn() };
    mockContainer = { get: vi.fn().mockReturnValue(mockBodyParser) };

    mockRequest = {
      length: 0,
      is: vi.fn(),
      type: '',
    };

    mockNext = vi.fn().mockResolvedValue(undefined);

    mockCtx = {
      request: mockRequest as any,
      req: {} as any,
      body: undefined,
      container: mockContainer as any,
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
        mockRequest.is.mockReturnValue(true);
        mockBodyParser.parse.mockResolvedValue({ parsed: { key: 'value' }, raw: '{"key":"value"}' });

        await middleware(mockCtx, mockNext);

        expect(mockContainer.get).toHaveBeenCalledWith(ServerKitBodyParser);
        expect(mockNext).toHaveBeenCalledTimes(1);
      });
    });

    describe('JSON body parsing', () => {
      it('should parse JSON body', async () => {
        const middleware = bodyParserMiddleware(['application/json']);
        const jsonData = { name: 'test', value: 123 };
        const rawJson = '{"name":"test","value":123}';
        mockRequest.length = 100;
        mockRequest.is.mockReturnValue(true);
        mockBodyParser.parse.mockResolvedValue({ parsed: jsonData, raw: rawJson });

        await middleware(mockCtx, mockNext);

        expect(mockContainer.get).toHaveBeenCalledWith(ServerKitBodyParser);
        expect(mockBodyParser.parse).toHaveBeenCalledWith(mockCtx);
        expect(mockCtx.body).toEqual(jsonData);
        expect(mockCtx.rawBody).toBe(rawJson);
        expect(mockNext).toHaveBeenCalledTimes(1);
      });

      it('should parse application/*+json content types', async () => {
        const middleware = bodyParserMiddleware(['application/vnd.api+json']);
        const jsonData = { data: 'test' };
        const rawJson = '{"data":"test"}';
        mockRequest.length = 100;
        mockRequest.is.mockReturnValue(true);
        mockBodyParser.parse.mockResolvedValue({ parsed: jsonData, raw: rawJson });

        await middleware(mockCtx, mockNext);

        expect(mockBodyParser.parse).toHaveBeenCalledWith(mockCtx);
        expect(mockCtx.body).toEqual(jsonData);
        expect(mockCtx.rawBody).toBe(rawJson);
      });
    });

    describe('URL-encoded body parsing', () => {
      it('should parse urlencoded body', async () => {
        const middleware = bodyParserMiddleware(['application/x-www-form-urlencoded']);
        const formData = { field1: 'value1', field2: 'value2' };
        const rawForm = 'field1=value1&field2=value2';
        mockRequest.length = 100;
        mockRequest.is.mockReturnValue(true);
        mockBodyParser.parse.mockResolvedValue({ parsed: formData, raw: rawForm });

        await middleware(mockCtx, mockNext);

        expect(mockBodyParser.parse).toHaveBeenCalledWith(mockCtx);
        expect(mockCtx.body).toEqual(formData);
        expect(mockCtx.rawBody).toBe(rawForm);
        expect(mockNext).toHaveBeenCalledTimes(1);
      });
    });

    describe('text body parsing', () => {
      it('should parse text/* body', async () => {
        const middleware = bodyParserMiddleware(['text/plain']);
        const textData = 'plain text content';
        mockRequest.length = 100;
        mockRequest.is.mockReturnValue(true);
        mockBodyParser.parse.mockResolvedValue({ parsed: textData, raw: textData });

        await middleware(mockCtx, mockNext);

        expect(mockBodyParser.parse).toHaveBeenCalledWith(mockCtx);
        expect(mockCtx.body).toBe(textData);
        expect(mockCtx.rawBody).toBe(textData);
        expect(mockNext).toHaveBeenCalledTimes(1);
      });
    });

    describe('multipart body parsing', () => {
      it('should set parsed multipart body', async () => {
        const middleware = bodyParserMiddleware(['multipart/form-data']);
        const mockMultipartBody = { fields: {} };
        mockRequest.length = 100;
        mockRequest.is.mockReturnValue(true);
        mockBodyParser.parse.mockResolvedValue({ parsed: mockMultipartBody, raw: undefined });

        await middleware(mockCtx, mockNext);

        expect(mockBodyParser.parse).toHaveBeenCalledWith(mockCtx);
        expect(mockCtx.body).toBe(mockMultipartBody);
        expect(mockCtx.rawBody).toBeUndefined();
        expect(mockNext).toHaveBeenCalledTimes(1);
      });
    });

    describe('binary body parsing', () => {
      it('should set parsed binary body', async () => {
        const middleware = bodyParserMiddleware(['application/pdf']);
        const pdfBuffer = Buffer.from('PDF content');
        mockRequest.length = 100;
        mockRequest.is.mockReturnValue(true);
        mockBodyParser.parse.mockResolvedValue({ parsed: pdfBuffer, raw: undefined });

        await middleware(mockCtx, mockNext);

        expect(mockBodyParser.parse).toHaveBeenCalledWith(mockCtx);
        expect(mockCtx.body).toBe(pdfBuffer);
        expect(mockCtx.rawBody).toBeUndefined();
        expect(mockNext).toHaveBeenCalledTimes(1);
      });
    });

    describe('unsupported media type', () => {
      it('should re-throw HttpError from parser for unsupported content type', async () => {
        const middleware = bodyParserMiddleware(['application/json']);
        mockRequest.length = 100;
        mockRequest.is.mockReturnValue(true);
        const parserError = httpError(415).withDetails({ body: 'Unsupported media type' });
        mockBodyParser.parse.mockRejectedValue(parserError);

        await expect(middleware(mockCtx, mockNext)).rejects.toThrow();

        try {
          await middleware(mockCtx, mockNext);
        } catch (error) {
          expect(error).toBeInstanceOf(HttpError);
          expect((error as HttpError).statusCode).toBe(415);
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
        mockRequest.is.mockReturnValue(true);
        mockBodyParser.parse.mockRejectedValue(httpErr);

        await expect(middleware(mockCtx, mockNext)).rejects.toBe(httpErr);
        expect(mockNext).not.toHaveBeenCalled();
      });

      it('should wrap non-HttpError in 422 error', async () => {
        const middleware = bodyParserMiddleware(['application/json']);
        const parseError = new Error('Parse failed');
        mockRequest.length = 100;
        mockRequest.is.mockReturnValue(true);
        mockBodyParser.parse.mockRejectedValue(parseError);

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
