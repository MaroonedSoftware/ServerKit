import { describe, it, expect } from 'vitest';
import { CamelCasePlugin, DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely';
import type { DatabaseConnection, KyselyPlugin, QueryResult } from 'kysely';
import { StripSysPeriodPlugin } from '../src/plugins/strip.sys.period.plugin.js';

const row = { id: 1, name: 'A', sys_period: '[2026-01-01,)' };

class RowsDriver extends DummyDriver {
  override async acquireConnection(): Promise<DatabaseConnection> {
    return {
      executeQuery: async () => ({ rows: [{ ...row }] }) as QueryResult<never>,
      streamQuery: async function* () {},
    };
  }
}

const database = (plugins: KyselyPlugin[]) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new RowsDriver(),
      createIntrospector: db => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    plugins,
  });

describe('StripSysPeriodPlugin', () => {
  const db = database([new CamelCasePlugin(), new StripSysPeriodPlugin()]);

  it('strips the column from a built query', async () => {
    expect(await db.selectFrom('person').selectAll().execute()).toEqual([{ id: 1, name: 'A' }]);
  });

  it('strips from returning rows', async () => {
    expect(await db.updateTable('person').set({ name: 'B' }).returningAll().execute()).toEqual([{ id: 1, name: 'A' }]);
  });

  it('strips whichever side of CamelCasePlugin it runs on', async () => {
    const snake = database([new StripSysPeriodPlugin()]);
    expect(await snake.selectFrom('person').selectAll().execute()).toEqual([{ id: 1, name: 'A' }]);
  });

  it('keeps the column on a history read, named in camelCase or snake_case', async () => {
    const expected = [{ id: 1, name: 'A', sysPeriod: row.sys_period }];
    expect(await db.selectFrom('audit.person_history').selectAll().execute()).toEqual(expected);
    expect(await db.selectFrom('audit.personHistory').selectAll().execute()).toEqual(expected);
  });

  it('keeps the column when an aliased history table is the source', async () => {
    const rows = await db.selectFrom('person_history as h').selectAll().execute();
    expect(rows[0]).toHaveProperty('sysPeriod');
  });

  it('keeps the column when history is joined', async () => {
    const rows = await db.selectFrom('person').innerJoin('person_history', 'person.id', 'person_history.id').selectAll().execute();
    expect(rows[0]).toHaveProperty('sysPeriod');
  });

  it('keeps the column when history is read through a WITH clause', async () => {
    const rows = await db
      .with('past', q => q.selectFrom('person_history').selectAll())
      .selectFrom('past')
      .selectAll()
      .execute();
    expect(rows[0]).toHaveProperty('sysPeriod');
  });

  it('keeps the column when history is in a union', async () => {
    const rows = await db.selectFrom('person').selectAll().unionAll(db.selectFrom('person_history').selectAll()).execute();
    expect(rows[0]).toHaveProperty('sysPeriod');
  });

  it('keeps the column on a raw query', async () => {
    const { rows } = await sql`select * from person`.execute(db);
    expect(rows[0]).toHaveProperty('sysPeriod');
  });

  it('takes its columns and suffix from options', async () => {
    const custom = database([new StripSysPeriodPlugin({ columns: ['name'], historySuffix: '_archive' })]);
    expect(await custom.selectFrom('person').selectAll().execute()).toEqual([{ id: 1, sys_period: row.sys_period }]);
    expect(await custom.selectFrom('person_archive').selectAll().execute()).toEqual([row]);
  });
});
