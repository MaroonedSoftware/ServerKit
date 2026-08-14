# AGENTS.md — @maroonedsoftware/kysely

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

The wiring that makes Kysely behave the way the rest of ServerKit expects against PostgreSQL:
`pg` type parsers that yield Luxon `DateTime` / `Interval` and native `BigInt` instead of strings,
a plugin preset that camelCases columns and converts `null` to `undefined`, a repository base class
with transaction propagation, a `NoResultError` → 404 mapper, and a dialect that stops an empty
`UPDATE ... SET` from becoming a Postgres syntax error.

Reach for it in any ServerKit app backed by Postgres. Do **not** expect a query builder, an ORM,
or migrations — Kysely itself provides the first, and migrations are yours.

## Install

```bash
pnpm add @maroonedsoftware/kysely kysely pg
```

Runtime dependencies: `@maroonedsoftware/errors`, `@maroonedsoftware/utilities`, `injectkit`,
`kysely`, `luxon`, `pg`. All are hard dependencies — there are no optional peers here.

## Position in the graph

- **Depends on:** `errors`, `utilities`.
- **Depended on by:** `johnny5` (via its `./kysely` subpath).
- **Subpath exports:** none. The package has no `exports` map at all.

## API surface

| Export                       | Kind            | Shape                                                                                                                        | Notes                                                                                             |
| ---------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `KyselyPool`                 | class           | `@Injectable() class KyselyPool extends pg.Pool {}`                                                                          | A `pg.Pool` that is a valid InjectKit token. No behaviour added.                                  |
| `KyselyPgTypeOverrides`      | constant        | `pg.TypeOverrides` instance                                                                                                  | Pass to the `types` option of a pool. Table below.                                                |
| `KyselyDefaultPlugins`       | constant        | `KyselyPlugin[]` — `[new CamelCasePlugin(), new NullToUndefinedPlugin()]`                                                    | The recommended preset. A **shared array of shared plugin instances**.                            |
| `NullToUndefinedPlugin`      | class           | `implements KyselyPlugin`                                                                                                    | **Shallow** `null` → `undefined` on result rows. Already in the preset.                           |
| `KyselyRepository<DB>`       | abstract class  | `@Injectable() constructor(protected readonly db: Kysely<DB>)`                                                               | Base class for repositories.                                                                      |
| `#withTransaction`           | method          | `<R>(method: (trx: Transaction<DB>) => Promise<R>, transaction?: Transaction<DB>) => Promise<R>`                             | Reuses `transaction` when given, otherwise starts one. Transaction propagation.                   |
| `#withSerializedTransaction` | method          | Same signature                                                                                                               | Sets isolation level `serializable` — **only when starting a new transaction**.                   |
| `isKyselyNoResultError`      | type guard      | `(error: Error) => error is NoResultError`                                                                                   | `NoResultError` comes from `.executeTakeFirstOrThrow()`.                                          |
| `KyselyErrorHandler`         | function        | `(error: Error) => never`                                                                                                    | `NoResultError` → `httpError(404).withDetails({ message })`; everything else re-thrown unchanged. |
| `OnKyselyError`              | class decorator | `() => ClassDecorator`                                                                                                       | Sugar for `OnError(KyselyErrorHandler)` from `@maroonedsoftware/errors`.                          |
| `EmptyUpdateRewriteDialect`  | class           | `extends PostgresDialect`. `new EmptyUpdateRewriteDialect(config: PostgresDialectConfig, logger?: EmptyUpdateRewriteLogger)` | Rewrites an empty single-table `UPDATE` into a no-op `SELECT`.                                    |
| `EmptyUpdateRewriteCompiler` | class           | `extends PostgresQueryCompiler`                                                                                              | Exported for advanced composition; most callers use the dialect.                                  |
| `EmptyUpdateRewriteLogger`   | interface       | `{ debug(message: string): void }`                                                                                           | Structural, so `@maroonedsoftware/logger`'s `Logger` satisfies it without a dependency.           |

### `KyselyPgTypeOverrides`

| PostgreSQL type | Default `pg` result | Override               |
| --------------- | ------------------- | ---------------------- |
| `TIMESTAMP`     | `string`            | Luxon `DateTime` (UTC) |
| `TIMESTAMPTZ`   | `string`            | Luxon `DateTime` (UTC) |
| `DATE`          | `string`            | Luxon `DateTime` (UTC) |
| `TIME`          | `string`            | Luxon `DateTime` (UTC) |
| `INT8` / bigint | `string`            | native `BigInt`        |
| `INTERVAL`      | `string`            | Luxon `Interval`       |
| `TINTERVAL`     | `string`            | Luxon `Interval`       |
| `TSTZRANGE`     | `string`            | Luxon `Interval`       |

## Canonical usage

```typescript
import { Kysely } from 'kysely';
import {
  KyselyPool,
  KyselyPgTypeOverrides,
  KyselyDefaultPlugins,
  EmptyUpdateRewriteDialect,
  KyselyRepository,
  OnKyselyError,
} from '@maroonedsoftware/kysely';

// Composition root
const pool = new KyselyPool({ connectionString: config.databaseUrl, types: KyselyPgTypeOverrides });

const db = new Kysely<Database>({
  dialect: new EmptyUpdateRewriteDialect({ pool }, logger),
  plugins: KyselyDefaultPlugins,
});

registry.register(KyselyPool).useValue(pool);
registry.register(Kysely).useValue(db);
```

```typescript
@OnKyselyError()
@Injectable()
export class UserRepository extends KyselyRepository<Database> {
  constructor(db: Kysely<Database>) {
    super(db);
  }

  // NoResultError becomes a 404 via the class decorator
  async findById(id: string) {
    return this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  }

  // Propagates an outer transaction when one is passed in
  async create(data: NewUser, trx?: Transaction<Database>) {
    return this.withTransaction(async t => {
      const user = await t.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow();
      await t.insertInto('audit_log').values({ userId: user.id, action: 'created' }).execute();
      return user;
    }, trx);
  }
}
```

## Rules for generated code

- Always pass `types: KyselyPgTypeOverrides` when constructing the pool. Without it, timestamps come
  back as strings and your `DateTime`-typed schema is a lie that only fails at runtime.
- Always pass `plugins: KyselyDefaultPlugins`. The camelCase mapping is assumed by every generated
  schema type in a ServerKit app.
- Type your `Database` interface with `DateTime`, `Interval`, and `bigint` for the overridden
  columns, matching what the parsers actually produce.
- Thread the optional `transaction` parameter through repository methods and pass it to
  `withTransaction`. That is the whole propagation mechanism: forget it and you get a second,
  independent transaction that can deadlock against the first.
- Use `EmptyUpdateRewriteDialect` rather than `PostgresDialect` in any app with PATCH-style
  endpoints.
- Apply `@OnKyselyError()` to repositories where a missing row should be a 404. Do not apply it
  where a missing row is a domain condition you handle yourself.
- Use `executeTakeFirstOrThrow()` when a row must exist and let the handler map it, rather than
  `executeTakeFirst()` followed by a manual null check.
- Register `Kysely` and `KyselyPool` as singletons.

## Gotchas

- **`KyselyDefaultPlugins` is a shared array of shared plugin instances.** It is a module-level
  constant, so every `Kysely` instance in the process gets the same `CamelCasePlugin` and
  `NullToUndefinedPlugin` objects. Fine as written (both are stateless), but do not mutate the array
  and do not add a stateful plugin to it.
- **`NullToUndefinedPlugin` is shallow.** Only top-level row properties are converted. A `jsonb`
  column deserialises to an object whose nested `null`s survive, so a type declaring
  `undefined` for a nested field is wrong.
- **`withSerializedTransaction` silently degrades when a transaction is passed in.** An in-progress
  transaction's isolation level cannot be changed, so the callback runs at whatever level the outer
  transaction used. Nothing warns you. If serializable is a correctness requirement, do not accept
  an outer transaction there.
- **`EmptyUpdateRewriteDialect` only handles single-table updates.** `UPDATE ... FROM` and join
  updates with an empty `SET` are deliberately left to fail with `42601`, on the reasoning that such
  a statement is almost certainly a bug.
- **A rewritten empty update reports `numUpdatedRows: 0n`** and fires no `UPDATE` triggers — no
  audit-log row, no `temporal_tables` history entry. The node stays an `UpdateQueryNode` so the
  executor still resolves an update result; only the emitted SQL is a `SELECT`.
- **This is a compiler, not a plugin, on purpose.** `QueryExecutor.transformQuery` requires a plugin
  to return a node of the same kind it received, so no plugin can turn an update into a select.
  Do not try to "simplify" it into one.
- **`INT8` columns become `bigint`**, which `JSON.stringify` throws on. Use `bigIntReplacer` /
  `bigIntReviver` from `@maroonedsoftware/utilities`, and `zBigint()` from `@maroonedsoftware/zod`
  in request schemas.
- **`KyselyErrorHandler` maps only `NoResultError`.** Postgres constraint violations pass straight
  through — use `@OnPostgresError()` from `@maroonedsoftware/errors` for those, or stack both
  decorators.
- **The `TSTZRANGE` parser returns the raw string when the literal does not match its regex**
  (unbounded or unquoted ranges), so the same column can yield an `Interval` or a `string`.

## Working inside this package

```
src/
  kysely.pool.ts                   KyselyPool
  kysely.type.overrides.ts         KyselyPgTypeOverrides and the three parsers (module-private)
  kysely.default.plugins.ts        KyselyDefaultPlugins
  plugins/
    null.to.undefined.plugin.ts    NullToUndefinedPlugin
  kysely.repository.ts             KyselyRepository
  kysely.error.handler.ts          isKyselyNoResultError, KyselyErrorHandler
  kysely.error.decorator.ts        OnKyselyError
  empty.update.rewrite.dialect.ts  EmptyUpdateRewriteDialect, EmptyUpdateRewriteCompiler,
                                   EmptyUpdateRewriteLogger
  index.ts                         Barrel
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- The type-override table is a data contract. Changing what a column type parses to changes every
  consumer's `Database` interface silently — the types still compile, the values are different.
- `EmptyUpdateRewriteLogger` is a **structural** interface specifically so this package does not
  depend on `@maroonedsoftware/logger`. Do not replace it with the real `Logger` type.
- The empty-update rewrite must keep the node an `UpdateQueryNode` so `.execute()` still resolves an
  update result, and must keep rows flowing through `transformResult` so the default plugins still
  apply.
- Transaction propagation (reuse when given, start when not) is the contract every repository in a
  consuming app is written against.
- `errors` and `utilities` are the only internal dependencies.

User-visible changes need a changeset in `.changeset/`.
