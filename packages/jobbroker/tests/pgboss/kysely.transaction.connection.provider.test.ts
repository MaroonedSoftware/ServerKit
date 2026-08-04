import { describe, it, expect, vi } from 'vitest';
import { PgBossConnectionProvider } from '../../src/pgboss/pgboss.connection.provider.js';
import { KyselyTransactionConnectionProvider, type KyselyLike } from '../../src/pgboss/kysely.transaction.connection.provider.js';

type ExecuteQuery = ReturnType<KyselyLike['withoutPlugins']>['executeQuery'];

/**
 * Minimal stand-in for a Kysely transaction: `withoutPlugins()` hands back a
 * distinct object so tests can prove which one the adapter was built from.
 */
const fakeTransaction = (rows: unknown[] = []) => {
  const executeQuery = vi.fn(async () => ({ rows })) as unknown as ExecuteQuery;
  const stripped = { executeQuery };
  const withoutPlugins = vi.fn(() => stripped);

  return { trx: { withoutPlugins } satisfies KyselyLike, stripped, withoutPlugins, executeQuery: executeQuery as unknown as ReturnType<typeof vi.fn> };
};

describe('KyselyTransactionConnectionProvider', () => {
  it('is a PgBossConnectionProvider so it can override the default binding', () => {
    const { trx } = fakeTransaction();

    expect(new KyselyTransactionConnectionProvider(trx)).toBeInstanceOf(PgBossConnectionProvider);
  });

  it('returns an executor instead of undefined', () => {
    const { trx } = fakeTransaction();

    const executor = new KyselyTransactionConnectionProvider(trx).executor();

    expect(executor).toBeDefined();
    expect(typeof executor.executeSql).toBe('function');
  });

  it('strips plugins before adapting the transaction', () => {
    const { trx, withoutPlugins } = fakeTransaction();

    new KyselyTransactionConnectionProvider(trx).executor();

    expect(withoutPlugins).toHaveBeenCalledOnce();
  });

  it('runs pg-boss SQL on the transaction connection', async () => {
    const { trx, executeQuery } = fakeTransaction();

    await new KyselyTransactionConnectionProvider(trx).executor().executeSql('insert into pgboss.job values ($1)', ['job-1']);

    expect(executeQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: 'insert into pgboss.job values ($1)',
        parameters: ['job-1'],
      }),
    );
  });

  it('defaults parameters to an empty list when pg-boss passes none', async () => {
    const { trx, executeQuery } = fakeTransaction();

    await new KyselyTransactionConnectionProvider(trx).executor().executeSql('select 1');

    expect(executeQuery).toHaveBeenCalledWith(expect.objectContaining({ parameters: [] }));
  });

  it('returns the rows the transaction produced', async () => {
    const { trx } = fakeTransaction([{ id: 'job-1' }]);

    const result = await new KyselyTransactionConnectionProvider(trx).executor().executeSql('select id from pgboss.job');

    expect(result.rows).toEqual([{ id: 'job-1' }]);
  });

  it('adapts the transaction on every call so a reused provider never caches a stale connection', () => {
    const { trx, withoutPlugins } = fakeTransaction();
    const provider = new KyselyTransactionConnectionProvider(trx);

    provider.executor();
    provider.executor();

    expect(withoutPlugins).toHaveBeenCalledTimes(2);
  });
});
