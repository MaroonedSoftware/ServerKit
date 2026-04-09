import { describe, it, expect } from 'vitest';
import { NoResultError } from 'kysely';
import { IsHttpError } from '@maroonedsoftware/errors';
import { isKyselyNoResultError, KyselyErrorHandler } from '../src/kysely.error.handler.js';

describe('isKyselyNoResultError', () => {
  it('should return true for a NoResultError', () => {
    const error = new NoResultError({} as any);
    expect(isKyselyNoResultError(error)).toBe(true);
  });

  it('should return false for a generic Error', () => {
    const error = new Error('something went wrong');
    expect(isKyselyNoResultError(error)).toBe(false);
  });

  it('should return false for a subclass of Error', () => {
    class CustomError extends Error {}
    const error = new CustomError('custom');
    expect(isKyselyNoResultError(error)).toBe(false);
  });

  it('should act as a type guard narrowing to NoResultError', () => {
    const error: Error = new NoResultError({} as any);
    if (isKyselyNoResultError(error)) {
      expect(error).toBeInstanceOf(NoResultError);
    } else {
      throw new Error('expected type guard to return true');
    }
  });
});

describe('KyselyErrorHandler', () => {
  it('should throw an HTTP 404 error for NoResultError', () => {
    const error = new NoResultError({} as any);
    expect(() => KyselyErrorHandler(error)).toThrow();
  });

  it('should throw an HttpError with status 404 for NoResultError', () => {
    const error = new NoResultError({} as any);
    try {
      KyselyErrorHandler(error);
    } catch (thrown) {
      expect(IsHttpError(thrown)).toBe(true);
      expect((thrown as any).statusCode).toBe(404);
    }
  });

  it('should include the original error message in details', () => {
    const error = new NoResultError({} as any);
    try {
      KyselyErrorHandler(error);
    } catch (thrown) {
      expect((thrown as any).details).toEqual({ message: error.message });
    }
  });

  it('should re-throw other errors unchanged', () => {
    const error = new Error('unrelated db error');
    expect(() => KyselyErrorHandler(error)).toThrow(error);
  });

  it('should re-throw custom error subclasses unchanged', () => {
    class DbError extends Error {}
    const error = new DbError('custom db error');
    expect(() => KyselyErrorHandler(error)).toThrow(error);
  });
});
