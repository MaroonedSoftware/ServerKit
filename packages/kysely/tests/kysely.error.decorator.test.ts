import { describe, it, expect } from 'vitest';
import { NoResultError } from 'kysely';
import { IsHttpError } from '@maroonedsoftware/errors';
import { OnKyselyError } from '../src/kysely.error.decorator.js';

describe('OnKyselyError decorator', () => {
  it('should convert NoResultError to an HTTP 404 when a method throws', async () => {
    @OnKyselyError()
    class TestRepo {
      async find(): Promise<void> {
        throw new NoResultError({} as any);
      }
    }

    const repo = new TestRepo();
    let caught: unknown;
    try {
      await repo.find();
    } catch (e) {
      caught = e;
    }

    expect(IsHttpError(caught)).toBe(true);
    expect((caught as any).statusCode).toBe(404);
  });

  it('should re-throw non-Kysely errors unchanged', async () => {
    const error = new Error('unexpected db error');

    @OnKyselyError()
    class TestRepo {
      async find(): Promise<void> {
        throw error;
      }
    }

    const repo = new TestRepo();
    await expect(repo.find()).rejects.toThrow(error);
  });

  it('should not interfere with methods that succeed', async () => {
    @OnKyselyError()
    class TestRepo {
      async find(): Promise<string> {
        return 'found';
      }
    }

    const repo = new TestRepo();
    const result = await repo.find();
    expect(result).toBe('found');
  });

  it('should handle synchronous methods that throw NoResultError', () => {
    @OnKyselyError()
    class TestRepo {
      findSync(): string {
        throw new NoResultError({} as any);
      }
    }

    const repo = new TestRepo();
    let caught: unknown;
    try {
      repo.findSync();
    } catch (e) {
      caught = e;
    }

    expect(IsHttpError(caught)).toBe(true);
    expect((caught as any).statusCode).toBe(404);
  });

  it('should apply to all methods on the class', async () => {
    @OnKyselyError()
    class TestRepo {
      async findById(): Promise<void> {
        throw new NoResultError({} as any);
      }

      async findByEmail(): Promise<void> {
        throw new NoResultError({} as any);
      }
    }

    const repo = new TestRepo();

    for (const method of [repo.findById.bind(repo), repo.findByEmail.bind(repo)]) {
      let caught: unknown;
      try {
        await method();
      } catch (e) {
        caught = e;
      }
      expect(IsHttpError(caught)).toBe(true);
      expect((caught as any).statusCode).toBe(404);
    }
  });
});
