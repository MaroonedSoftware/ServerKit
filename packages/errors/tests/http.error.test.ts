import { describe, it, expect } from 'vitest';
import { HttpError, IsHttpError, httpError, unauthorizedError } from '../src/http/http.error.js';
import { HttpStatusMap } from '../src/http/http.status.map.js';

describe('HttpError', () => {
  describe('constructor', () => {
    it('should create an HttpError with status code and default message', () => {
      const error = new HttpError(404);
      expect(error).toBeInstanceOf(HttpError);
      expect(error).toBeInstanceOf(Error);
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe(HttpStatusMap[404]);
    });

    it('should have correct prototype chain', () => {
      const error = new HttpError(500);
      expect(Object.getPrototypeOf(error)).toBe(HttpError.prototype);
      expect(error instanceof HttpError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });

    it('should have Symbol.toStringTag set to Object', () => {
      const error = new HttpError(400);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((error as any)[Symbol.toStringTag]).toBe('Object');
    });
  });

  describe('withDetails', () => {
    it('should set details and return the error instance', () => {
      const error = new HttpError(400);
      const details = { field1: 'Error 1', field2: 'Error 2' };
      const result = error.withDetails(details);

      expect(result).toBe(error);
      expect(error.details).toEqual(details);
    });

    it('should allow chaining', () => {
      const error = new HttpError(400).withDetails({ field1: 'Error 1' }).withHeaders({ 'X-Custom': 'value' });

      expect(error.details).toEqual({ field1: 'Error 1' });
      expect(error.headers).toEqual({ 'X-Custom': 'value' });
    });
  });

  describe('withHeaders', () => {
    it('should set headers and return the error instance', () => {
      const error = new HttpError(401);
      const headers = { 'WWW-Authenticate': 'Bearer' };
      const result = error.withHeaders(headers);

      expect(result).toBe(error);
      expect(error.headers).toEqual(headers);
    });

    it('should allow chaining', () => {
      const error = new HttpError(401).withHeaders({ 'WWW-Authenticate': 'Bearer' }).withCause(new Error('Original error'));

      expect(error.headers).toEqual({ 'WWW-Authenticate': 'Bearer' });
      expect(error.cause).toBeInstanceOf(Error);
    });
  });

  describe('withCause', () => {
    it('should set cause and return the error instance', () => {
      const error = new HttpError(500);
      const originalError = new Error('Original error');
      const result = error.withCause(originalError);

      expect(result).toBe(error);
      expect(error.cause).toBe(originalError);
    });

    it('should allow chaining', () => {
      const originalError = new Error('Original error');
      const error = new HttpError(500).withCause(originalError).withInternalDetails({ stack: 'stack trace' });

      expect(error.cause).toBe(originalError);
      expect(error.internalDetails).toEqual({ stack: 'stack trace' });
    });
  });

  describe('withInternalDetails', () => {
    it('should set internalDetails and return the error instance', () => {
      const error = new HttpError(500);
      const internalDetails = { debug: 'info', timestamp: Date.now() };
      const result = error.withInternalDetails(internalDetails);

      expect(result).toBe(error);
      expect(error.internalDetails).toEqual(internalDetails);
    });

    it('should allow chaining', () => {
      const error = new HttpError(500).withInternalDetails({ debug: 'info' }).withDetails({ validation: 'failed' });

      expect(error.internalDetails).toEqual({ debug: 'info' });
      expect(error.details).toEqual({ validation: 'failed' });
    });
  });

  describe('all methods chaining', () => {
    it('should allow chaining all methods together', () => {
      const originalError = new Error('Original');
      const error = new HttpError(422)
        .withDetails({ email: 'Invalid email' })
        .withHeaders({ 'X-Error-Code': 'VALIDATION_FAILED' })
        .withCause(originalError)
        .withInternalDetails({ userId: 123, requestId: 'abc-123' });

      expect(error.statusCode).toBe(422);
      expect(error.details).toEqual({ email: 'Invalid email' });
      expect(error.headers).toEqual({ 'X-Error-Code': 'VALIDATION_FAILED' });
      expect(error.cause).toBe(originalError);
      expect(error.internalDetails).toEqual({
        userId: 123,
        requestId: 'abc-123',
      });
    });
  });
});

describe('IsHttpError', () => {
  it('should return true for HttpError instances', () => {
    const error = new HttpError(404);
    expect(IsHttpError(error)).toBe(true);
  });

  it('should return false for regular Error instances', () => {
    const error = new Error('Regular error');
    expect(IsHttpError(error)).toBe(false);
  });

  it('should return false for non-error values', () => {
    expect(IsHttpError(null)).toBe(false);
    expect(IsHttpError(undefined)).toBe(false);
    expect(IsHttpError('string')).toBe(false);
    expect(IsHttpError(123)).toBe(false);
    expect(IsHttpError({})).toBe(false);
  });

  it('should work as a type guard', () => {
    const error: unknown = new HttpError(500);
    if (IsHttpError(error)) {
      // TypeScript should know error is HttpError here
      expect(error.statusCode).toBe(500);
    }
  });
});

describe('addHeader', () => {
  it('should set a header and return the error instance', () => {
    const error = new HttpError(401);
    const result = error.addHeader('WWW-Authenticate', 'Bearer');

    expect(result).toBe(error);
    expect(error.headers).toEqual({ 'WWW-Authenticate': 'Bearer' });
  });

  it('should initialise the headers object when none exist', () => {
    const error = new HttpError(401);
    expect(error.headers).toBeUndefined();

    error.addHeader('X-Custom', 'value');

    expect(error.headers).toEqual({ 'X-Custom': 'value' });
  });

  it('should accumulate multiple headers with successive calls', () => {
    const error = new HttpError(401);
    error.addHeader('WWW-Authenticate', 'Bearer');
    error.addHeader('X-Request-Id', 'abc-123');

    expect(error.headers).toEqual({
      'WWW-Authenticate': 'Bearer',
      'X-Request-Id': 'abc-123',
    });
  });

  it('should overwrite an existing header with the same key', () => {
    const error = new HttpError(401);
    error.addHeader('WWW-Authenticate', 'Bearer');
    error.addHeader('WWW-Authenticate', 'Basic');

    expect(error.headers).toEqual({ 'WWW-Authenticate': 'Basic' });
  });

  it('should not affect headers previously set via withHeaders', () => {
    const error = new HttpError(401).withHeaders({ 'X-Existing': 'yes' });
    error.addHeader('X-New', 'also-yes');

    expect(error.headers).toEqual({ 'X-Existing': 'yes', 'X-New': 'also-yes' });
  });

  it('should allow chaining', () => {
    const error = new HttpError(401)
      .addHeader('WWW-Authenticate', 'Bearer')
      .addHeader('X-Custom', 'value');

    expect(error.headers).toEqual({
      'WWW-Authenticate': 'Bearer',
      'X-Custom': 'value',
    });
  });
});

describe('unauthorizedError factory function', () => {
  it('should create an HttpError with status code 401', () => {
    const error = unauthorizedError('Bearer realm="api"');

    expect(error).toBeInstanceOf(HttpError);
    expect(error.statusCode).toBe(401);
  });

  it('should set the WWW-Authenticate header to the provided value', () => {
    const error = unauthorizedError('Bearer realm="api"');

    expect(error.headers).toEqual({ 'WWW-Authenticate': 'Bearer realm="api"' });
  });

  it('should use the default 401 status message', () => {
    const error = unauthorizedError('Bearer');

    expect(error.message).toBe(HttpStatusMap[401]);
  });

  it('should work with a plain scheme string', () => {
    const error = unauthorizedError('Bearer');

    expect(error.headers?.['WWW-Authenticate']).toBe('Bearer');
  });

  it('should work with a Basic scheme string', () => {
    const error = unauthorizedError('Basic realm="restricted"');

    expect(error.headers?.['WWW-Authenticate']).toBe('Basic realm="restricted"');
  });

  it('should be chainable with other HttpError methods', () => {
    const cause = new Error('token expired');
    const error = unauthorizedError('Bearer error="invalid_token"').withCause(cause);

    expect(error.statusCode).toBe(401);
    expect(error.headers?.['WWW-Authenticate']).toBe('Bearer error="invalid_token"');
    expect(error.cause).toBe(cause);
  });
});

describe('httpError factory function', () => {
  it('should create HttpError with status code and default message', () => {
    const error = httpError(404);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.statusCode).toBe(404);
    expect(error.message).toBe(HttpStatusMap[404]);
  });

  it('should work with all status codes', () => {
    const statusCodes: Array<keyof typeof HttpStatusMap> = Object.keys(HttpStatusMap).map(Number) as Array<keyof typeof HttpStatusMap>;
    statusCodes.forEach(statusCode => {
      const error = httpError(statusCode);
      expect(error.statusCode).toBe(statusCode);
      expect(error.message).toBe(HttpStatusMap[statusCode]);
    });
  });
});
