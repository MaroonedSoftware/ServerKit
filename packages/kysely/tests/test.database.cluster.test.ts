import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { TestDatabaseCluster } from '../src/testing/test.database.cluster.js';

const adminUrl = process.env.TEST_POSTGRES_URL;

const query = async (url: string, text: string, values: unknown[] = []) => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return (await client.query(text, values)).rows;
  } finally {
    await client.end();
  }
};

const prefix = `tdc_${process.pid}`;

const databases = async (): Promise<string[]> => {
  const rows = await query(adminUrl!, `select datname from pg_database where datname like $1`, [`${prefix}%`]);
  return rows.map(row => row.datname as string);
};

describe('TestDatabaseCluster', () => {
  it('rejects a prefix that would not be a safe name', () => {
    expect(() => new TestDatabaseCluster({ adminUrl: 'postgres://x/y', prefix: 'a"; drop' })).toThrow('Invalid test database prefix');
  });
});

describe.skipIf(!adminUrl)('TestDatabaseCluster, on Postgres', () => {
  const cluster = () => new TestDatabaseCluster({ adminUrl: adminUrl!, prefix });
  const migrate = (templateUrl: string) => query(templateUrl, 'create table seeded (id int)').then(() => undefined);

  afterAll(async () => {
    for (const name of await databases()) {
      await query(adminUrl!, `alter database "${name}" is_template false`);
      await query(adminUrl!, `drop database "${name}" with (force)`);
    }
  });

  it('clones the prepared template, keeps clones apart, and drops everything at the end', async () => {
    const run = await cluster().startRun(migrate);
    const first = await cluster().clone(run.id, 'file:///repo/tests/one.test.ts');
    const second = await cluster().clone(run.id, 'file:///repo/tests/one.test.ts');

    expect(first.name).not.toBe(second.name);
    await query(first.url, 'insert into seeded values (1)');
    expect(await query(second.url, 'select * from seeded')).toEqual([]);

    await first.drop();
    expect(await databases()).not.toContain(first.name);

    await run.finish();
    expect(await databases()).toEqual([]);
  });

  it('keeps a long label inside the identifier limit', async () => {
    const run = await cluster().startRun(migrate);
    const clone = await cluster().clone(run.id, 'x'.repeat(200));
    expect(clone.name.length).toBeLessThanOrEqual(63);
    expect(await databases()).toContain(clone.name);
    await run.finish();
  });

  it('sweeps an old run whose beacon has gone, and leaves a live one alone', async () => {
    const live = await cluster().startRun(migrate);
    const abandoned = `${prefix}_10000000_abcd1234_template`;
    await query(adminUrl!, `create database "${abandoned}"`);
    const foreign = [`${prefix}_beta_db`, `${prefix}_10000000_notes`, `${prefix}_10000000_abcd1234_notes`];
    for (const name of foreign) await query(adminUrl!, `create database "${name}"`);

    const next = await new TestDatabaseCluster({ adminUrl: adminUrl!, prefix, staleRunMs: 0 }).startRun(migrate);

    const names = await databases();
    expect(names).not.toContain(abandoned);
    expect(names).toEqual(expect.arrayContaining(foreign));
    expect(names).toContain(`${prefix}_${live.id}_template`);
    await next.finish();
    await live.finish();
  });

  it('reports a failed prepare', async () => {
    await expect(cluster().startRun(() => Promise.reject(new Error('migration failed')))).rejects.toThrow('migration failed');
  });
});
