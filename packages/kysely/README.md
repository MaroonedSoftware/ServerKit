# @maroonedsoftware/kysely

Kysely utilities for ServerKit — type-safe PostgreSQL integration with dependency injection, automatic error mapping, and sensible defaults.

## Installation

```bash
pnpm add @maroonedsoftware/kysely reflect-metadata
```

`kysely`, `pg`, `luxon`, and `injectkit` are bundled as direct dependencies — you do not need to install them separately, but you may import from them directly.

> **Note:** InjectKit requires `reflect-metadata` to be imported at your application entry point and TypeScript configured with `experimentalDecorators: true` and `emitDecoratorMetadata: true`.

## Features

- **`KyselyPool`** — Injectable `pg.Pool` wrapper for use with InjectKit DI
- **`KyselyRepository`** — Abstract base class with transaction propagation helpers
- **`OnKyselyError`** — Class decorator that maps `NoResultError` to HTTP 404
- **`KyselyDefaultPlugins`** — Pre-configured plugin set (camelCase + null→undefined)
- **`KyselyPgTypeOverrides`** — PostgreSQL type parsers for timestamps and bigints
- **`NullToUndefinedPlugin`** — Converts `null` result values to `undefined`

## Code Generation

Use [kysely-codegen](https://github.com/RobinBlomberg/kysely-codegen) to generate TypeScript types from your database schema. The configuration below aligns with `KyselyPgTypeOverrides` and `KyselyDefaultPlugins` so that generated types match what the runtime produces.

`.kysely-codegenrc.json`:

```json
{
  "camelCase": true,
  "customImports": {
    "DateTime": "luxon",
    "Duration": "luxon",
    "Interval": "luxon"
  },
  "dateParser": "timestamp",
  "defaultSchemas": ["public"],
  "dialect": "postgres",
  "domains": true,
  "envFile": ".env",
  "excludePattern": null,
  "includePattern": null,
  "logLevel": "warn",
  "numericParser": "string",
  "outFile": "./src/modules/data/kysely.ts",
  "overrides": {},
  "partitions": false,
  "print": false,
  "runtimeEnums": false,
  "singularize": false,
  "typeMapping": {
    "date": "DateTime",
    "timestamptz": "DateTime",
    "interval": "Duration",
    "tstzrange": "Interval",
    "int8": "bigint"
  },
  "typeOnlyImports": true,
  "url": "env(DATABASE_URL)",
  "verify": false
}
```

Key options explained:

- **`camelCase: true`** — Matches `CamelCasePlugin` so column names are consistent between generated types and runtime results
- **`typeMapping`** — Maps `timestamptz` → `DateTime`, `tstzrange` → `Interval`, and `int8` → `bigint`, matching the runtime parsers in `KyselyPgTypeOverrides`
- **`customImports`** — Imports `DateTime` and `Duration` from `luxon` rather than generating inline type aliases
- **`outFile`** — Path to the generated `Database` type used throughout your repositories

## Quick Start

### 1. Set Up the Pool and Kysely Instance

```typescript
import 'reflect-metadata';
import { Kysely, PostgresDialect } from 'kysely';
import { InjectKitRegistry } from 'injectkit';
import { KyselyPool, KyselyPgTypeOverrides, KyselyDefaultPlugins } from '@maroonedsoftware/kysely';

const diRegistry = new InjectKitRegistry();

diRegistry.register(KyselyPool).useInstance(
  new KyselyPool({
    connectionString: process.env.DATABASE_URL,
    types: KyselyPgTypeOverrides,
  }),
);

diRegistry
  .register(Kysely)
  .useFactory(container => {
    return new Kysely<Database>({
      dialect: new PostgresDialect({ pool: container.get(KyselyPool) }),
      plugins: KyselyDefaultPlugins,
    });
  })
  .asSingleton();
```

### 2. Create a Repository

Extend `KyselyRepository` to get transaction helpers and DI support:

```typescript
import { Injectable } from 'injectkit';
import { Kysely } from 'kysely';
import { KyselyRepository, OnKyselyError } from '@maroonedsoftware/kysely';
import { Database } from './database.js';

@OnKyselyError()
@Injectable()
export class UserRepository extends KyselyRepository<Database> {
  async findById(id: number) {
    // NoResultError is automatically converted to HTTP 404
    return this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  }

  async create(data: NewUser) {
    return this.withTransaction(async trx => {
      const user = await trx.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow();
      await trx.insertInto('audit_log').values({ userId: user.id, action: 'created' }).execute();
      return user;
    });
  }
}
```

### 3. Transaction Propagation

Both transaction helpers accept an optional existing transaction. When provided, the callback runs inside that transaction rather than opening a new one — making it easy to compose repository methods without nested transactions:

```typescript
async transferFunds(fromId: number, toId: number, amount: number) {
  return this.withSerializedTransaction(async trx => {
    await this.debit(fromId, amount, trx);   // reuses trx
    await this.credit(toId, amount, trx);    // reuses trx
  });
}

async debit(id: number, amount: number, transaction?: Transaction<Database>) {
  return this.withTransaction(async trx => {
    await trx.updateTable('accounts').set({ balance: sql`balance - ${amount}` }).where('id', '=', id).execute();
  }, transaction);
}
```

## Error Handling

`@OnKyselyError()` wraps every method on the decorated class so that Kysely's `NoResultError` (thrown by `.executeTakeFirstOrThrow()` when no row matches) is automatically converted to an HTTP 404:

```typescript
import { OnKyselyError, KyselyErrorHandler, isKyselyNoResultError } from '@maroonedsoftware/kysely';

// Decorator (recommended) — applied at the class level
@OnKyselyError()
class UserRepository extends KyselyRepository<Database> { ... }

// Manual usage
try {
  await userRepository.findById(id);
} catch (error) {
  KyselyErrorHandler(error);
}

// Type guard
if (isKyselyNoResultError(error)) {
  // error is narrowed to NoResultError
}
```

## PostgreSQL Type Overrides

`KyselyPgTypeOverrides` registers custom parsers for the following types:

| PostgreSQL type   | Default JS type | Override               |
| ----------------- | --------------- | ---------------------- |
| `TIMESTAMP`       | `string`        | Luxon `DateTime` (UTC) |
| `TIMESTAMPTZ`     | `string`        | Luxon `DateTime` (UTC) |
| `DATE`            | `string`        | Luxon `DateTime` (UTC) |
| `TIME`            | `string`        | Luxon `DateTime` (UTC) |
| `INT8` / `bigint` | `string`        | `BigInt`               |
| `INTERVAL`        | `string`        | Luxon `Interval`       |
| `TINTERVAL`       | `string`        | Luxon `Interval`       |
| `TSTZRANGE`       | `string`        | Luxon `Interval`       |

Pass it to the `types` option of `KyselyPool`:

```typescript
const pool = new KyselyPool({
  connectionString: process.env.DATABASE_URL,
  types: KyselyPgTypeOverrides,
});
```

## Default Plugins

`KyselyDefaultPlugins` is a pre-configured array containing:

- **`CamelCasePlugin`** — Maps `snake_case` column names to `camelCase` in TypeScript (`created_at` → `createdAt`)
- **`NullToUndefinedPlugin`** — Replaces `null` values in query results with `undefined`

```typescript
const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool }),
  plugins: KyselyDefaultPlugins,
});
```

## API Reference

### `KyselyPool`

An injectable subclass of `pg.Pool`. Register it in your DI container and inject it wherever a pool is needed.

### `KyselyRepository<DB>`

Abstract base class for repositories. Inject a `Kysely<DB>` instance via the constructor.

| Method                                            | Description                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------- |
| `withTransaction(method, transaction?)`           | Runs `method` inside a transaction. Reuses `transaction` if provided. |
| `withSerializedTransaction(method, transaction?)` | Same as `withTransaction` but with `serializable` isolation level.    |

### `OnKyselyError()`

Class decorator. Wraps all methods so `NoResultError` becomes `HttpError(404)` and all other errors are re-thrown unchanged.

### `KyselyErrorHandler(error)`

Function form of the Kysely error handler. Throws `HttpError(404)` for `NoResultError`, re-throws everything else.

### `isKyselyNoResultError(error)`

Type guard that returns `true` when `error` is a Kysely `NoResultError`.

### `KyselyDefaultPlugins`

`KyselyPlugin[]` — `[CamelCasePlugin, NullToUndefinedPlugin]`

### `KyselyPgTypeOverrides`

`pg.TypeOverrides` — Custom parsers for `TIMESTAMP`, `TIMESTAMPTZ`, `DATE`, `TIME`, `INT8`, `INTERVAL`, `TINTERVAL`, and `TSTZRANGE`.

### `NullToUndefinedPlugin`

Kysely plugin that shallowly converts `null` values to `undefined` in every query result row.

## Dependencies

- `kysely` ^0.28.16 — Type-safe SQL query builder
- `pg` ^8.20.0 — PostgreSQL driver
- `luxon` ^3.7.2 — Used by `KyselyPgTypeOverrides` for `DateTime` and `Interval` parsing
- `injectkit` ^1.2.0 — Dependency injection (`@Injectable()`)
- `reflect-metadata` — Required by InjectKit for decorator metadata (install separately)

## License

MIT
