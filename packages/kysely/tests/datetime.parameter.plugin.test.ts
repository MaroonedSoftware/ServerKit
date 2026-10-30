import { describe, it, expect } from 'vitest';
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely';
import { DateTime } from 'luxon';
import { DateTimeParameterPlugin } from '../src/plugins/datetime.parameter.plugin.js';

type Database = { events: { id: number; name: string; at: DateTime } };

describe('DateTimeParameterPlugin', () => {
  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: db => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    plugins: [new DateTimeParameterPlugin()],
  });
  const at = DateTime.fromISO('2030-01-02T03:04:05.678-05:00', { setZone: true });
  const iso = '2030-01-02T03:04:05.678-05:00';

  it('should convert a where parameter', () => {
    const { parameters } = db.selectFrom('events').selectAll().where('at', '>', at).compile();
    expect(parameters).toEqual([iso]);
  });

  it('should convert a value in a where in list', () => {
    const { parameters } = db.selectFrom('events').selectAll().where('at', 'in', [at, at]).compile();
    expect(parameters).toEqual([iso, iso]);
  });

  it('should convert a single-row insert', () => {
    const { parameters } = db.insertInto('events').values({ id: 1, name: 'a', at }).compile();
    expect(parameters).toEqual([1, 'a', iso]);
  });

  it('should convert a multi-row insert', () => {
    const { parameters } = db
      .insertInto('events')
      .values([
        { id: 1, name: 'a', at },
        { id: 2, name: 'b', at },
      ])
      .compile();
    expect(parameters).toEqual([1, 'a', iso, 2, 'b', iso]);
  });

  it('should convert an update', () => {
    const { parameters } = db.updateTable('events').set({ at }).compile();
    expect(parameters).toEqual([iso]);
  });

  it('should convert an on conflict update', () => {
    const { parameters } = db
      .insertInto('events')
      .values({ id: 1, name: 'a', at })
      .onConflict(oc => oc.column('id').doUpdateSet({ at }))
      .compile();
    expect(parameters).toEqual([1, 'a', iso, iso]);
  });

  it('should convert a raw sql parameter', () => {
    const { parameters } = sql`select ${at}::timestamptz`.compile(db);
    expect(parameters).toEqual([iso]);
  });

  it('should leave other parameters unchanged', () => {
    const date = new Date(0);
    const { parameters } = sql`select ${date}, ${1n}, ${'a'}, ${null}`.compile(db);
    expect(parameters).toEqual([date, 1n, 'a', null]);
  });

  it('should throw on an invalid DateTime', () => {
    const query = db.selectFrom('events').selectAll().where('at', '>', DateTime.invalid('bad input'));
    expect(() => query.compile()).toThrow('invalid DateTime');
  });

  it('should return the result unchanged', async () => {
    const result = { rows: [{ at }] };
    await expect(new DateTimeParameterPlugin().transformResult({ queryId: { queryId: 'q' }, result })).resolves.toBe(result);
  });
});
