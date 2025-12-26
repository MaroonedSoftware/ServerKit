import { describe, it, expect } from 'vitest';
import { PostgresErrorHandler, PostgresError } from '../src/postgres/postgres.error.handler.js';
import { HttpError, IsHttpError } from '../src/http/http.error.js';

const createPostgresError = (code: string, message = 'Postgres error'): PostgresError => {
  const error = new Error(message) as PostgresError;
  error.code = code;
  return error;
};

describe('PostgresErrorHandler', () => {
  describe('unique constraint violation (23505)', () => {
    it('should throw 409 Conflict error', () => {
      const error = createPostgresError('23505', 'duplicate key value violates unique constraint');
      expect(() => PostgresErrorHandler(error)).toThrow();
      try {
        PostgresErrorHandler(error);
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(409);
        expect(httpError.cause).toBe(error);
      }
    });
  });

  describe('foreign key violation (23503)', () => {
    it('should throw 404 Not Found error', () => {
      const error = createPostgresError('23503', 'foreign key constraint violated');
      expect(() => PostgresErrorHandler(error)).toThrow();
      try {
        PostgresErrorHandler(error);
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(404);
        expect(httpError.cause).toBe(error);
      }
    });
  });

  describe('not null violation (23502)', () => {
    it('should throw 400 Bad Request error', () => {
      const error = createPostgresError('23502', 'null value in column violates not-null constraint');
      expect(() => PostgresErrorHandler(error)).toThrow();
      try {
        PostgresErrorHandler(error);
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(400);
        expect(httpError.cause).toBe(error);
      }
    });
  });

  describe('invalid text representation (22P02)', () => {
    it('should throw 400 Bad Request error', () => {
      const error = createPostgresError('22P02', 'invalid input syntax');
      expect(() => PostgresErrorHandler(error)).toThrow();
      try {
        PostgresErrorHandler(error);
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(400);
        expect(httpError.cause).toBe(error);
      }
    });
  });

  describe('numeric value out of range (22003)', () => {
    it('should throw 400 Bad Request error', () => {
      const error = createPostgresError('22003', 'numeric value out of range');
      expect(() => PostgresErrorHandler(error)).toThrow();
      try {
        PostgresErrorHandler(error);
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(400);
        expect(httpError.cause).toBe(error);
      }
    });
  });

  describe('check constraint violation (23514)', () => {
    it('should throw 400 Bad Request error', () => {
      const error = createPostgresError('23514', 'check constraint violated');
      expect(() => PostgresErrorHandler(error)).toThrow();
      try {
        PostgresErrorHandler(error);
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(400);
        expect(httpError.cause).toBe(error);
      }
    });
  });

  describe('transaction rollback errors', () => {
    it('should throw 500 Internal Server Error for 40000', () => {
      const error = createPostgresError('40000', 'transaction rollback');
      expect(() => PostgresErrorHandler(error)).toThrow();
      try {
        PostgresErrorHandler(error);
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(500);
        expect(httpError.cause).toBe(error);
        expect(httpError.internalDetails).toEqual({
          msg: 'Transaction rollback',
        });
      }
    });

    it('should throw 500 Internal Server Error for 40001', () => {
      const error = createPostgresError('40001', 'serialization failure');
      expect(() => PostgresErrorHandler(error)).toThrow();
      try {
        PostgresErrorHandler(error);
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(500);
        expect(httpError.cause).toBe(error);
        expect(httpError.internalDetails).toEqual({
          msg: 'Transaction rollback',
        });
      }
    });

    it('should throw 500 Internal Server Error for 40002', () => {
      const error = createPostgresError('40002', 'transaction integrity constraint violation');
      expect(() => PostgresErrorHandler(error)).toThrow();
      try {
        PostgresErrorHandler(error);
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(500);
        expect(httpError.cause).toBe(error);
        expect(httpError.internalDetails).toEqual({
          msg: 'Transaction rollback',
        });
      }
    });
  });

  describe('deadlock (40P01)', () => {
    it('should throw 500 Internal Server Error with deadlock message', () => {
      const error = createPostgresError('40P01', 'deadlock detected');
      expect(() => PostgresErrorHandler(error)).toThrow();
      try {
        PostgresErrorHandler(error);
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(500);
        expect(httpError.cause).toBe(error);
        expect(httpError.internalDetails).toEqual({ msg: 'Deadlock' });
      }
    });
  });

  describe('unknown postgres error codes', () => {
    it('should throw 500 Internal Server Error for unknown codes', () => {
      const error = createPostgresError('99999', 'unknown error');
      expect(() => PostgresErrorHandler(error)).toThrow();
      try {
        PostgresErrorHandler(error);
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(500);
        expect(httpError.cause).toBe(error);
        expect(httpError.internalDetails).toBeUndefined();
      }
    });
  });

  describe('non-postgres errors', () => {
    it('should re-throw non-postgres errors as-is', () => {
      const error = new Error('Regular JavaScript error');
      expect(() => PostgresErrorHandler(error)).toThrow('Regular JavaScript error');
      try {
        PostgresErrorHandler(error);
      } catch (thrown) {
        expect(thrown).toBe(error);
        expect(IsHttpError(thrown)).toBe(false);
      }
    });

    it('should re-throw errors without code property', () => {
      const error = new Error('Error without code') as Error & {
        code?: string;
      };
      delete error.code;
      expect(() => PostgresErrorHandler(error)).toThrow('Error without code');
      try {
        PostgresErrorHandler(error);
      } catch (thrown) {
        expect(thrown).toBe(error);
        expect(IsHttpError(thrown)).toBe(false);
      }
    });
  });
});
