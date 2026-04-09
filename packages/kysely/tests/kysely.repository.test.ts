import { describe, it, expect, vi } from 'vitest';
import { Kysely, Transaction } from 'kysely';
import { KyselyRepository } from '../src/kysely.repository.js';

interface TestDB {
  users: { id: number; name: string };
}

class TestRepository extends KyselyRepository<TestDB> {
  constructor(db: Kysely<TestDB>) {
    super(db);
  }
}

function createMockDb() {
  const mockExecute = vi.fn();
  const mockSetIsolationLevel = vi.fn().mockReturnValue({ execute: mockExecute });
  const mockTransaction = vi.fn().mockReturnValue({
    execute: mockExecute,
    setIsolationLevel: mockSetIsolationLevel,
  });

  const db = { transaction: mockTransaction } as unknown as Kysely<TestDB>;
  return { db, mockExecute, mockTransaction, mockSetIsolationLevel };
}

describe('KyselyRepository', () => {
  describe('withTransaction', () => {
    it('should start a new transaction when none is provided', async () => {
      const { db, mockTransaction, mockExecute } = createMockDb();
      const repo = new TestRepository(db);
      mockExecute.mockImplementation((fn: (trx: Transaction<TestDB>) => Promise<string>) => fn({} as Transaction<TestDB>));

      await repo.withTransaction(async () => 'result');

      expect(mockTransaction).toHaveBeenCalledOnce();
      expect(mockExecute).toHaveBeenCalledOnce();
    });

    it('should use the provided transaction without starting a new one', async () => {
      const { db, mockTransaction } = createMockDb();
      const repo = new TestRepository(db);
      const existingTrx = {} as Transaction<TestDB>;
      const callback = vi.fn().mockResolvedValue('result');

      await repo.withTransaction(callback, existingTrx);

      expect(mockTransaction).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(existingTrx);
    });

    it('should return the value from the callback', async () => {
      const { db, mockExecute } = createMockDb();
      const repo = new TestRepository(db);
      mockExecute.mockImplementation((fn: (trx: Transaction<TestDB>) => Promise<string>) => fn({} as Transaction<TestDB>));

      const result = await repo.withTransaction(async () => 'hello');

      expect(result).toBe('hello');
    });

    it('should pass the transaction to the callback', async () => {
      const { db, mockExecute } = createMockDb();
      const repo = new TestRepository(db);
      const trx = { _isMock: true } as unknown as Transaction<TestDB>;
      mockExecute.mockImplementation((fn: (trx: Transaction<TestDB>) => Promise<void>) => fn(trx));
      const callback = vi.fn().mockResolvedValue(undefined);

      await repo.withTransaction(callback);

      expect(callback).toHaveBeenCalledWith(trx);
    });

    it('should propagate errors thrown inside the callback', async () => {
      const { db, mockExecute } = createMockDb();
      const repo = new TestRepository(db);
      const error = new Error('transaction failed');
      mockExecute.mockImplementation((fn: (trx: Transaction<TestDB>) => Promise<void>) => fn({} as Transaction<TestDB>));

      await expect(
        repo.withTransaction(async () => {
          throw error;
        }),
      ).rejects.toThrow(error);
    });

    it('should return the result when called with an existing transaction', async () => {
      const { db } = createMockDb();
      const repo = new TestRepository(db);
      const existingTrx = {} as Transaction<TestDB>;

      const result = await repo.withTransaction(async () => 42, existingTrx);

      expect(result).toBe(42);
    });
  });

  describe('withSerializedTransaction', () => {
    it('should start a new serializable transaction when none is provided', async () => {
      const { db, mockTransaction, mockSetIsolationLevel, mockExecute } = createMockDb();
      const repo = new TestRepository(db);
      mockExecute.mockImplementation((fn: (trx: Transaction<TestDB>) => Promise<string>) => fn({} as Transaction<TestDB>));

      await repo.withSerializedTransaction(async () => 'result');

      expect(mockTransaction).toHaveBeenCalledOnce();
      expect(mockSetIsolationLevel).toHaveBeenCalledWith('serializable');
      expect(mockExecute).toHaveBeenCalledOnce();
    });

    it('should use the provided transaction without starting a new one', async () => {
      const { db, mockTransaction } = createMockDb();
      const repo = new TestRepository(db);
      const existingTrx = {} as Transaction<TestDB>;
      const callback = vi.fn().mockResolvedValue('result');

      await repo.withSerializedTransaction(callback, existingTrx);

      expect(mockTransaction).not.toHaveBeenCalled();
      expect(callback).toHaveBeenCalledWith(existingTrx);
    });

    it('should return the value from the callback', async () => {
      const { db, mockExecute } = createMockDb();
      const repo = new TestRepository(db);
      mockExecute.mockImplementation((fn: (trx: Transaction<TestDB>) => Promise<number>) => fn({} as Transaction<TestDB>));

      const result = await repo.withSerializedTransaction(async () => 99);

      expect(result).toBe(99);
    });

    it('should propagate errors thrown inside the callback', async () => {
      const { db, mockExecute } = createMockDb();
      const repo = new TestRepository(db);
      const error = new Error('serialized transaction failed');
      mockExecute.mockImplementation((fn: (trx: Transaction<TestDB>) => Promise<void>) => fn({} as Transaction<TestDB>));

      await expect(
        repo.withSerializedTransaction(async () => {
          throw error;
        }),
      ).rejects.toThrow(error);
    });

    it('should return the result when called with an existing transaction', async () => {
      const { db } = createMockDb();
      const repo = new TestRepository(db);
      const existingTrx = {} as Transaction<TestDB>;

      const result = await repo.withSerializedTransaction(async () => 'serialized', existingTrx);

      expect(result).toBe('serialized');
    });
  });
});
