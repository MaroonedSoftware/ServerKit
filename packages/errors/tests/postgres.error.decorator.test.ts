import { describe, it, expect } from 'vitest';
import { OnPostgresError } from '../src/postgres/postgres.error.decorator.js';
import { PostgresError } from '../src/postgres/postgres.error.handler.js';
import { HttpError, IsHttpError } from '../src/http/http.error.js';

const createPostgresError = (code: string, message = 'Postgres error'): PostgresError => {
  const error = new Error(message) as PostgresError;
  error.code = code;
  return error;
};

describe('OnPostgresError decorator', () => {
  describe('unique constraint violation (23505)', () => {
    it('should convert to 409 Conflict error in synchronous method', () => {
      @OnPostgresError()
      class TestClass {
        method(): void {
          throw createPostgresError('23505', 'duplicate key value violates unique constraint');
        }
      }

      const instance = new TestClass();
      expect(() => instance.method()).toThrow();
      try {
        instance.method();
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(409);
        expect(httpError.cause).toBeDefined();
        expect((httpError.cause as PostgresError).code).toBe('23505');
      }
    });

    it('should convert to 409 Conflict error in async method', async () => {
      @OnPostgresError()
      class TestClass {
        async method(): Promise<void> {
          throw createPostgresError('23505', 'duplicate key value violates unique constraint');
        }
      }

      const instance = new TestClass();
      await expect(instance.method()).rejects.toThrow();
      try {
        await instance.method();
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(409);
        expect(httpError.cause).toBeDefined();
        expect((httpError.cause as PostgresError).code).toBe('23505');
      }
    });
  });

  describe('foreign key violation (23503)', () => {
    it('should convert to 404 Not Found error', () => {
      @OnPostgresError()
      class TestClass {
        method(): void {
          throw createPostgresError('23503', 'foreign key constraint violated');
        }
      }

      const instance = new TestClass();
      expect(() => instance.method()).toThrow();
      try {
        instance.method();
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(404);
        expect((httpError.cause as PostgresError).code).toBe('23503');
      }
    });
  });

  describe('validation errors', () => {
    it('should convert 23502 to 400 Bad Request error', () => {
      @OnPostgresError()
      class TestClass {
        method(): void {
          throw createPostgresError('23502', 'null value in column violates not-null constraint');
        }
      }

      const instance = new TestClass();
      try {
        instance.method();
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(400);
        expect((httpError.cause as PostgresError).code).toBe('23502');
      }
    });

    it('should convert 22P02 to 400 Bad Request error', () => {
      @OnPostgresError()
      class TestClass {
        method(): void {
          throw createPostgresError('22P02', 'invalid input syntax');
        }
      }

      const instance = new TestClass();
      try {
        instance.method();
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(400);
        expect((httpError.cause as PostgresError).code).toBe('22P02');
      }
    });

    it('should convert 22003 to 400 Bad Request error', () => {
      @OnPostgresError()
      class TestClass {
        method(): void {
          throw createPostgresError('22003', 'numeric value out of range');
        }
      }

      const instance = new TestClass();
      try {
        instance.method();
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(400);
        expect((httpError.cause as PostgresError).code).toBe('22003');
      }
    });

    it('should convert 23514 to 400 Bad Request error', () => {
      @OnPostgresError()
      class TestClass {
        method(): void {
          throw createPostgresError('23514', 'check constraint violated');
        }
      }

      const instance = new TestClass();
      try {
        instance.method();
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(400);
        expect((httpError.cause as PostgresError).code).toBe('23514');
      }
    });
  });

  describe('transaction rollback errors', () => {
    it('should convert 40000 to 500 Internal Server Error with internal details', () => {
      @OnPostgresError()
      class TestClass {
        method(): void {
          throw createPostgresError('40000', 'transaction rollback');
        }
      }

      const instance = new TestClass();
      try {
        instance.method();
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(500);
        expect(httpError.internalDetails).toEqual({
          msg: 'Transaction rollback',
        });
        expect((httpError.cause as PostgresError).code).toBe('40000');
      }
    });

    it('should convert 40001 to 500 Internal Server Error with internal details', () => {
      @OnPostgresError()
      class TestClass {
        method(): void {
          throw createPostgresError('40001', 'serialization failure');
        }
      }

      const instance = new TestClass();
      try {
        instance.method();
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(500);
        expect(httpError.internalDetails).toEqual({
          msg: 'Transaction rollback',
        });
        expect((httpError.cause as PostgresError).code).toBe('40001');
      }
    });

    it('should convert 40002 to 500 Internal Server Error with internal details', () => {
      @OnPostgresError()
      class TestClass {
        method(): void {
          throw createPostgresError('40002', 'transaction integrity constraint violation');
        }
      }

      const instance = new TestClass();
      try {
        instance.method();
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(500);
        expect(httpError.internalDetails).toEqual({
          msg: 'Transaction rollback',
        });
        expect((httpError.cause as PostgresError).code).toBe('40002');
      }
    });
  });

  describe('deadlock (40P01)', () => {
    it('should convert to 500 Internal Server Error with deadlock message', () => {
      @OnPostgresError()
      class TestClass {
        method(): void {
          throw createPostgresError('40P01', 'deadlock detected');
        }
      }

      const instance = new TestClass();
      try {
        instance.method();
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(500);
        expect(httpError.internalDetails).toEqual({ msg: 'Deadlock' });
        expect((httpError.cause as PostgresError).code).toBe('40P01');
      }
    });
  });

  describe('unknown postgres error codes', () => {
    it('should convert unknown codes to 500 Internal Server Error', () => {
      @OnPostgresError()
      class TestClass {
        method(): void {
          throw createPostgresError('99999', 'unknown error');
        }
      }

      const instance = new TestClass();
      try {
        instance.method();
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        const httpError = thrown as HttpError;
        expect(httpError.statusCode).toBe(500);
        expect(httpError.internalDetails).toBeUndefined();
        expect((httpError.cause as PostgresError).code).toBe('99999');
      }
    });
  });

  describe('non-postgres errors', () => {
    it('should re-throw non-postgres errors as-is', () => {
      const regularError = new Error('Regular JavaScript error');

      @OnPostgresError()
      class TestClass {
        method(): void {
          throw regularError;
        }
      }

      const instance = new TestClass();
      expect(() => instance.method()).toThrow('Regular JavaScript error');
      try {
        instance.method();
      } catch (thrown) {
        expect(thrown).toBe(regularError);
        expect(IsHttpError(thrown)).toBe(false);
      }
    });

    it('should re-throw errors without code property', () => {
      const error = new Error('Error without code') as Error & {
        code?: string;
      };
      delete error.code;

      @OnPostgresError()
      class TestClass {
        method(): void {
          throw error;
        }
      }

      const instance = new TestClass();
      expect(() => instance.method()).toThrow('Error without code');
      try {
        instance.method();
      } catch (thrown) {
        expect(thrown).toBe(error);
        expect(IsHttpError(thrown)).toBe(false);
      }
    });
  });

  describe('successful method calls', () => {
    it('should not interfere with successful synchronous methods', () => {
      @OnPostgresError()
      class TestClass {
        method(value: number): number {
          return value * 2;
        }
      }

      const instance = new TestClass();
      const result = instance.method(5);
      expect(result).toBe(10);
    });

    it('should not interfere with successful async methods', async () => {
      @OnPostgresError()
      class TestClass {
        async method(value: number): Promise<number> {
          return value * 2;
        }
      }

      const instance = new TestClass();
      const result = await instance.method(5);
      expect(result).toBe(10);
    });

    it('should not interfere with methods that return values', () => {
      @OnPostgresError()
      class TestClass {
        method(): string {
          return 'success';
        }
      }

      const instance = new TestClass();
      const result = instance.method();
      expect(result).toBe('success');
    });
  });

  describe('multiple methods', () => {
    it('should handle errors from multiple methods independently', () => {
      @OnPostgresError()
      class TestClass {
        method1(): void {
          throw createPostgresError('23505', 'unique constraint');
        }

        method2(): void {
          throw createPostgresError('23503', 'foreign key');
        }
      }

      const instance = new TestClass();

      try {
        instance.method1();
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        expect((thrown as HttpError).statusCode).toBe(409);
      }

      try {
        instance.method2();
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        expect((thrown as HttpError).statusCode).toBe(404);
      }
    });
  });

  describe('getter and setter', () => {
    it('should handle errors in getters', () => {
      @OnPostgresError()
      class TestClass {
        get value(): string {
          throw createPostgresError('23505', 'unique constraint');
        }
      }

      const instance = new TestClass();
      expect(() => instance.value).toThrow();
      try {
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        instance.value;
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        expect((thrown as HttpError).statusCode).toBe(409);
      }
    });

    it('should handle errors in setters', () => {
      @OnPostgresError()
      class TestClass {
        set value(v: string) {
          throw createPostgresError('23503', 'foreign key');
        }
      }

      const instance = new TestClass();
      expect(() => {
        instance.value = 'test';
      }).toThrow();
      try {
        instance.value = 'test';
      } catch (thrown) {
        expect(IsHttpError(thrown)).toBe(true);
        expect((thrown as HttpError).statusCode).toBe(404);
      }
    });
  });
});
