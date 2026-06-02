import { describe, it, expect, vi } from 'vitest';
import { Kysely } from 'kysely';
import { EmptyUpdateRewriteDialect } from '../src/empty.update.rewrite.dialect.js';
import { KyselyDefaultPlugins } from '../src/kysely.default.plugins.js';

interface TestDB {
  persons: {
    id: string;
    displayName: string | null;
    locale: string | null;
  };
}

// `.compile()` exercises the dialect's query compiler without touching the pool,
// so these are pure unit tests — no database connection required. A fake pool
// satisfies the config; it is only used at execution time.
const fakePool = {} as never;

const makeDb = (logger?: { debug: (message: string) => void }) =>
  new Kysely<TestDB>({
    dialect: new EmptyUpdateRewriteDialect({ pool: fakePool }, logger),
    plugins: KyselyDefaultPlugins,
  });

describe('EmptyUpdateRewriteDialect', () => {
  it('compiles an empty update with returning as a SELECT of the current row', () => {
    const db = makeDb();
    const compiled = db.updateTable('persons').set({}).where('id', '=', 'abc').returningAll().compile();

    expect(compiled.sql).toMatch(/^select/i);
    expect(compiled.sql).not.toMatch(/\bupdate\b/i);
    expect(compiled.sql).toContain('from "persons"');
    expect(compiled.sql).toContain('where "id" = $1');
    expect(compiled.parameters).toEqual(['abc']);
  });

  it('treats an all-undefined set as empty (Kysely drops undefined keys)', () => {
    const db = makeDb();
    const compiled = db
      .updateTable('persons')
      .set({ displayName: undefined, locale: undefined })
      .where('id', '=', 'abc')
      .returningAll()
      .compile();

    expect(compiled.sql).toMatch(/^select/i);
    expect(compiled.sql).not.toMatch(/\bupdate\b/i);
  });

  it('compiles an empty update without returning as SELECT *', () => {
    const db = makeDb();
    const compiled = db.updateTable('persons').set({}).where('id', '=', 'abc').compile();

    expect(compiled.sql).toMatch(/^select \*/i);
    expect(compiled.sql).toContain('from "persons"');
  });

  it('leaves a non-empty update unchanged', () => {
    const db = makeDb();
    const compiled = db.updateTable('persons').set({ displayName: 'Ada' }).where('id', '=', 'abc').compile();

    expect(compiled.sql).toMatch(/^update "persons" set/i);
    // CamelCasePlugin lowercases the column to snake_case.
    expect(compiled.sql).toContain('"display_name" = $1');
    expect(compiled.parameters).toEqual(['Ada', 'abc']);
  });

  it('leaves a multi-table update (UPDATE ... FROM) with an empty set unchanged', () => {
    const db = makeDb();
    const compiled = db.updateTable('persons').from('persons as other').set({}).whereRef('persons.id', '=', 'other.id').compile();

    expect(compiled.sql).toMatch(/^update /i);
  });

  it('emits a debug log when rewriting an empty update', () => {
    const debug = vi.fn();
    const db = makeDb({ debug });
    db.updateTable('persons').set({}).where('id', '=', 'abc').returningAll().compile();

    expect(debug).toHaveBeenCalledOnce();
    expect(debug.mock.calls[0]?.[0]).toContain('persons');
  });

  it('does not log for a normal update', () => {
    const debug = vi.fn();
    const db = makeDb({ debug });
    db.updateTable('persons').set({ displayName: 'Ada' }).where('id', '=', 'abc').compile();

    expect(debug).not.toHaveBeenCalled();
  });
});
