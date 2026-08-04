import { describe, it, expect, vi } from 'vitest';
import {
  CamelCasePlugin,
  CompiledQuery,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type KyselyPlugin,
  type QueryResult,
} from 'kysely';
import { PgBossConnectionProvider } from '../../src/pgboss/pgboss.connection.provider.js';
import { KyselyTransactionConnectionProvider, type KyselyLike } from '../../src/pgboss/kysely.transaction.connection.provider.js';

type ExecuteQuery = ReturnType<KyselyLike['withoutPlugins']>['executeQuery'];

interface TestDB {
  job: { id: string; created_on: string };
}

/**
 * Driver that records every compiled query it is handed and replays a fixed row
 * set, so tests can watch what actually reaches the connection without a
 * database.
 */
class RecordingDriver extends DummyDriver {
  readonly queries: { sql: string; parameters: readonly unknown[] }[] = [];

  constructor(private readonly rows: unknown[] = []) {
    super();
  }

  override async acquireConnection(): Promise<DatabaseConnection> {
    return {
      executeQuery: async <R>(compiled: CompiledQuery<unknown>): Promise<QueryResult<R>> => {
        this.queries.push({ sql: compiled.sql, parameters: compiled.parameters });
        return { rows: [...this.rows] as R[] };
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      streamQuery: async function* () {
        // Streaming is never used by the pg-boss adapter.
      },
    };
  }
}

const realKysely = (driver: RecordingDriver, plugins: KyselyPlugin[] = []) =>
  new Kysely<TestDB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: db => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    plugins,
  });

/**
 * Minimal stand-in for a Kysely transaction: `withoutPlugins()` hands back a
 * distinct object so tests can prove which one the adapter was built from.
 */
const fakeTransaction = (rows: unknown[] = []) => {
  const executeQuery = vi.fn(async () => ({ rows })) as unknown as ExecuteQuery;
  const stripped = { executeQuery };
  const withoutPlugins = vi.fn(() => stripped);

  return {
    trx: { withoutPlugins } satisfies KyselyLike,
    stripped,
    withoutPlugins,
    executeQuery: executeQuery as unknown as ReturnType<typeof vi.fn>,
  };
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

describe('KyselyTransactionConnectionProvider with a real Kysely instance', () => {
  it('runs pg-boss SQL on a real Kysely instance', async () => {
    const driver = new RecordingDriver();
    const db = realKysely(driver);

    await new KyselyTransactionConnectionProvider(db).executor().executeSql('insert into pgboss.job values ($1)', ['job-1']);

    expect(driver.queries).toEqual([{ sql: 'insert into pgboss.job values ($1)', parameters: ['job-1'] }]);
  });

  it('runs pg-boss SQL on the connection held by a real transaction', async () => {
    const driver = new RecordingDriver();
    const db = realKysely(driver);

    await db.transaction().execute(async trx => {
      await new KyselyTransactionConnectionProvider(trx).executor().executeSql('insert into pgboss.job values ($1)', ['job-1']);
    });

    expect(driver.queries).toEqual([{ sql: 'insert into pgboss.job values ($1)', parameters: ['job-1'] }]);
  });

  it("leaves pg-boss's own result columns alone when the caller's instance rewrites them", async () => {
    const driver = new RecordingDriver([{ id: 'job-1', created_on: '2026-08-04' }]);
    const db = realKysely(driver, [new CamelCasePlugin()]);

    // Control: the caller's own reads go through the plugin, which camel-cases the columns.
    const throughPlugin = await db.executeQuery(CompiledQuery.raw('select id, created_on from pgboss.job'));
    expect(throughPlugin.rows).toEqual([{ id: 'job-1', createdOn: '2026-08-04' }]);

    // pg-boss reads the same rows with the plugin stripped, so its columns survive.
    const throughProvider = await new KyselyTransactionConnectionProvider(db).executor().executeSql('select id, created_on from pgboss.job');
    expect(throughProvider.rows).toEqual([{ id: 'job-1', created_on: '2026-08-04' }]);
  });
});
