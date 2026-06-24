# @maroonedsoftware/appconfig

A flexible, type-safe configuration management library with support for multiple sources, `${…}` reference resolution, and hot reload.

## Features

- **Type-safe access** - Full TypeScript support with generics
- **Multiple sources** - Load configuration from JSON files, YAML files, `.env` files, Postgres, and AWS/GCP secret managers
- **Reference resolution** - Resolve environment variables, GCP secrets, and AWS secrets via `${…}` resolvers
- **Intra-config references** - Resolve `${ref:some.path}` references against the config itself (opt-in)
- **Deep merging** - Combine configurations from multiple sources with predictable override behavior
- **Flat key grouping** - Collapse `KEY__sub=val` dotenv entries into nested objects automatically
- **Hot reload** - Rebuild config on demand (e.g. when a secret rotates), or let watchable sources (file/Postgres) trigger reloads; inject one C#-style options token per section (`.value` / `.current` / `.onChange`)
- **Extensible** - Create custom sources and resolvers for your specific needs

> **Terminology:** a **source** loads a configuration layer (`load()`); a **resolver** substitutes `${scheme:…}` reference tokens within values. (Other libraries call resolvers "providers" — ServerKit keeps the two concerns separately named.)

## Contents

- [Installation](#installation)
- [Usage](#usage) — [basic](#basic-usage), [the builder](#using-the-builder), [reference resolution](#reference-resolution)
- [API](#api) — [`AppConfig`](#appconfig), [`AppConfigBuilder`](#appconfigbuilder)
- [Sources](#sources) — [JSON](#appconfigsourcejson), [YAML](#appconfigsourceyaml), [Dotenv](#appconfigsourcedotenv), [Postgres](#appconfigsourcepostgres), [AWS](#appconfigsourceawssecrets) / [GCP](#appconfigsourcegcpsecrets) secrets
- [Intra-config references](#intra-config-references) — `${ref:some.path}`
- [Resolvers](#resolvers) — [env](#appconfigresolverenv), [GCP](#appconfigresolvergcpsecrets) / [AWS](#appconfigresolverawssecrets) secrets, [Postgres](#appconfigresolverpostgres)
- [Live configuration](#live-configuration) — [`AppConfigModule`](#wiring-with-appconfigmodule), [reloading](#reloading), [consuming a section](#consuming-a-section), [`AppConfigStore`](#appconfigstore)
- [Utilities](#utilities) — [`nestKeys`](#nestkeys)
- [Custom sources and resolvers](#custom-sources-and-resolvers)
- [Configuration merging](#configuration-merging)

## Installation

```bash
pnpm add @maroonedsoftware/appconfig
```

## Usage

### Basic Usage

```typescript
import { AppConfig } from '@maroonedsoftware/appconfig';

const config = new AppConfig({
  database: { host: 'localhost', port: 5432 },
  api: { timeout: 5000 },
  port: '3000',
});

const database = config.get('database');                // Type-safe access
const port = config.getNumber('port');                  // Returns 3000 as number
const db = config.getAs<{ host: string }>('database');  // Cast to interface
```

### Using the Builder

The `AppConfigBuilder` allows you to load configuration from multiple sources and apply transformations:

```typescript
import {
  AppConfigBuilder,
  AppConfigSourceJson,
  AppConfigSourceYaml,
  AppConfigSourceDotenv,
  AppConfigResolverEnv,
} from '@maroonedsoftware/appconfig';

const config = await new AppConfigBuilder()
  .addSource(new AppConfigSourceJson('./config.json'))
  .addSource(new AppConfigSourceYaml('./config.yaml'))
  .addSource(new AppConfigSourceDotenv('.env'))
  .addResolver(new AppConfigResolverEnv())
  .buildSnapshot<MyConfigType>();
```

### Reference resolution

Any string value across the merged config may contain `${scheme:KEY}` reference tokens. After the sources are merged, each [resolver](#resolvers) you add rewrites the tokens it recognises — `${env:…}` from environment variables, `${gcp:…}`/`${aws:…}` from a secret manager, `${pg:…}` from a Postgres table — and resolved values are JSON-parsed, so `"5432"` becomes the number `5432`.

```json
// config.json
{
  "database": {
    "host": "${env:DB_HOST}",
    "port": "${env:DB_PORT}",
    "password": "${aws:DB_PASSWORD}"
  }
}
```

```typescript
const config = await new AppConfigBuilder()
  .addSource(new AppConfigSourceJson('./config.json'))
  .addSource(new AppConfigSourceDotenv('.env')) // populates process.env-style values for ${env:…}
  .addResolver(new AppConfigResolverEnv()) // ${env:…}
  .addResolver(new AppConfigResolverAwsSecrets('us-east-1')) // ${aws:…}
  .buildSnapshot();
```

See [Resolvers](#resolvers) for each scheme and its options, and [Intra-config references](#intra-config-references) for `${ref:some.path}` (one value pointing at another).

## API

### AppConfig

The configuration container providing type-safe access to configuration values.

| Method                   | Description                                                              |
| ------------------------ | ------------------------------------------------------------------------ |
| `has(key)`               | Returns `true` when the value is present (not `undefined` or `null`)     |
| `get(key)`               | Returns the value for the key with full type safety                      |
| `get(key, defaultValue)` | Returns `defaultValue` when the value is missing (`undefined`/`null`)    |
| `getAs<U>(key)`          | Returns the value cast to the specified type `U`                         |
| `getString(key)`         | Returns the value converted to a string                                  |
| `getNumber(key)`         | Returns the value converted to a number                                  |
| `getBoolean(key)`        | Returns the value converted to a boolean                                 |
| `getObject(key)`         | Returns the value cast as an object                                      |

### AppConfigBuilder

Builder for constructing `AppConfig` instances from multiple sources.

| Method                   | Description                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `addSource(source)`      | Adds a configuration source (later sources override earlier)                         |
| `addResolver(resolver)`  | Adds a resolver to substitute `${…}` references in string values                     |
| `resolveReferences(on?)` | Enables the intra-config `${ref:some.path}` resolution pass (default `true`)         |
| `buildSnapshot<T>()`     | Builds and returns a one-shot, immutable `AppConfig` (no hot reload)                 |
| `buildStore<T>(logger?)` | Builds a hot-reloadable [`AppConfigStore`](#appconfigstore) that owns/watches sources |

### Sources

#### AppConfigSourceJson

Loads configuration from a JSON file.

```typescript
// Basic usage (ignores missing file by default)
const source = new AppConfigSourceJson('./config.json');

// Throw error if file is missing
const source = new AppConfigSourceJson('./config.json', {
  ignoreMissingFile: false,
});

// Custom encoding
const source = new AppConfigSourceJson('./config.json', {
  encoding: 'utf16le',
});
```

#### AppConfigSourceYaml

Loads configuration from a YAML file. Supports both `.yaml` and `.yml` extensions.

```typescript
// Basic usage (ignores missing file by default)
const source = new AppConfigSourceYaml('./config.yaml');

// Throw error if file is missing
const source = new AppConfigSourceYaml('./config.yaml', {
  ignoreMissingFile: false,
});

// Custom encoding
const source = new AppConfigSourceYaml('./config.yaml', {
  encoding: 'utf16le',
});
```

YAML files support all standard YAML features including nested objects, arrays, multiline strings, and anchors:

```yaml
# config.yaml
database:
  host: localhost
  port: 5432
  credentials:
    username: admin
    password: ${env:DB_PASSWORD}

features:
  - feature1
  - feature2

description: |
  This is a multiline
  string value
```

#### AppConfigSourceDotenv

Loads environment variables from a `.env` file (parsed with `dotenv.parse`). It is a **pure** source — it returns the parsed variables as a config layer and does **not** mutate `process.env`. Like the other file sources it extends [`AppConfigSourceFile`](#custom-sources-and-resolvers): it ignores a missing file by default (`ignoreMissingFile`), honors `encoding`, and is watchable via `fs.watch`. The default path is `.env` in the current working directory.

```typescript
// Load from default .env file
const source = new AppConfigSourceDotenv();

// Load from custom path
const source = new AppConfigSourceDotenv('./config/.env.local');

// Group keys with __ separator into nested objects
const source = new AppConfigSourceDotenv('./.env', { groupSeparator: '__' });
```

##### `groupSeparator` option

When set, any key containing the separator is split into path segments and written into a nested object. Keys without the separator are passed through unchanged. Arbitrary nesting depth is supported.

**.env:**

```
PAYMENT_PROVIDER_WEBHOOK__secret=blah
PAYMENT_PROVIDER_WEBHOOK__header=X-Signature
PAYMENT_PROVIDER_WEBHOOK__algorithm=sha256
PAYMENT_PROVIDER_WEBHOOK__digest=hex
DATABASE_URL=postgres://localhost/db
```

**app.ts:**

```typescript
const source = new AppConfigSourceDotenv('./.env', { groupSeparator: '__' });
const config = await source.load();
// →
// {
//   PAYMENT_PROVIDER_WEBHOOK: {
//     secret: 'blah',
//     header: 'X-Signature',
//     algorithm: 'sha256',
//     digest: 'hex',
//   },
//   DATABASE_URL: 'postgres://localhost/db',
// }
```

The `groupSeparator` option also integrates naturally with the builder. Because grouping happens at the source level, all downstream resolvers (e.g. `AppConfigResolverEnv`) see the already-nested object:

```typescript
const config = await new AppConfigBuilder()
  .addSource(new AppConfigSourceJson('./config.json'))
  .addSource(new AppConfigSourceDotenv('./.env', { groupSeparator: '__' }))
  .addResolver(new AppConfigResolverEnv())
  .buildSnapshot<MyConfig>();
```

You can also call `nestKeys` directly if you need to transform a plain record outside of a source:

```typescript
import { nestKeys } from '@maroonedsoftware/appconfig';

const nested = nestKeys(process.env as Record<string, unknown>, '__');
```

##### AppConfigSourceDotenvOptions

Extends `AppConfigSourceFileOptions` (`ignoreMissingFile`, `encoding`) with:

| Option            | Type      | Description                                                                                             |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| `groupSeparator`  | `string`  | Optional. When set, keys containing this string are split into nested objects (e.g. `'__'`). |
| `ignoreMissingFile` | `boolean` | Optional, defaults to `true`. Returns `{}` for a missing file instead of throwing. |
| `encoding`        | `BufferEncoding` | Optional, defaults to `'utf8'`. |

#### AppConfigSourcePostgres

Loads configuration from a key/value table in Postgres. Useful for settings that
live in the database and can change without a redeploy (combine it with the
[live reload](#live-configuration) store to pick up changes at runtime).

```typescript
import { AppConfigBuilder, AppConfigSourcePostgres } from '@maroonedsoftware/appconfig';

const source = new AppConfigSourcePostgres(logger, {
  connection: { host: 'db', port: 5432, user: 'app', password: 'secret', database: 'app' },
  schema: 'config',      // optional, defaults to 'public'
  table: 'app_settings', // optional, defaults to 'settings'
  keyColumn: 'name',     // optional, defaults to 'key'
  valueColumn: 'val',    // optional, defaults to 'value'
});

const config = await new AppConfigBuilder().addSource(source).buildSnapshot();
```

The source reads every row from `schema.table` and returns the `keyColumn`/`valueColumn`
pair as a flat configuration record (rows with a null value are skipped). It is
deliberately forgiving at boot: if the schema or table does not exist yet (e.g.
before the first migration), it logs a warning and returns an empty object
instead of throwing, so file and env defaults still apply.

##### Resolving variables in the connection

The values _loaded_ from the table already flow through the builder's resolvers
like any other source. The connection parameters, though, are needed before the
source can connect — so pass the same resolvers via the `resolvers` option to
resolve `${env:…}` / `${gcp:…}` / `${aws:…}` references (e.g. a database password
held in a secret manager) before connecting. The connection is re-resolved on
every `load()`, so a rotated secret is picked up on the next [reload](#live-configuration).

```typescript
import { AppConfigSourcePostgres, AppConfigResolverAwsSecrets } from '@maroonedsoftware/appconfig';

const source = new AppConfigSourcePostgres(logger, {
  connection: {
    host: '${env:DB_HOST}',
    port: 5432,
    user: 'app',
    password: '${aws:DB_PASSWORD}', // fetched from AWS Secrets Manager before connecting
    database: 'app',
  },
  resolvers: [new AppConfigResolverEnv(), new AppConfigResolverAwsSecrets('us-east-1')],
});
```

##### AppConfigSourcePostgresOptions

| Option        | Type                          | Description                                                                |
| ------------- | ----------------------------- | ------------------------------------------------------------------------- |
| `connection`  | `AppConfigSourcePostgresConnection` | Postgres connection parameters (host, port, user, password, database). Required. |
| `schema`      | `string`                      | Schema holding the settings table. Optional, defaults to `public`.        |
| `table`       | `string`                      | Table holding the key/value rows. Optional, defaults to `settings`.       |
| `keyColumn`   | `string`                      | Column read as the config key. Optional, defaults to `key`.               |
| `valueColumn` | `string`                      | Column read as the config value. Optional, defaults to `value`.           |
| `resolvers`   | `AppConfigResolver[]`         | Resolvers used to resolve `${…}` references in `connection` before connecting. Optional, defaults to none (verbatim). |
| `notifyChannel` | `string`                    | When set, the source is *watchable*: it `LISTEN`s on this Postgres channel and triggers a reload on every `NOTIFY`. Optional; without it, reload stays application-driven. |

> **Note:** `pg` is a peer dependency — install it alongside this package (`pnpm add pg`) when using the Postgres source.

##### Hot reload via `LISTEN`/`NOTIFY`

Set `notifyChannel` to make the Postgres source [watchable](#reloading): it opens a dedicated `LISTEN`er and reloads whenever the database emits a matching `NOTIFY` — so settings changes propagate without an external trigger. Have the settings table notify on change (typically a trigger):

```sql
CREATE FUNCTION notify_appconfig() RETURNS trigger AS $$
  BEGIN PERFORM pg_notify('appconfig', ''); RETURN NULL; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER appconfig_changed AFTER INSERT OR UPDATE OR DELETE ON config.settings
  FOR EACH STATEMENT EXECUTE FUNCTION notify_appconfig();
```

```typescript
const pg = new AppConfigSourcePostgres(logger, { connection, schema: 'config', notifyChannel: 'appconfig' });
const store = await new AppConfigBuilder().addSource(pg).buildStore(logger);
// store now reloads automatically on NOTIFY 'appconfig'; store.dispose() closes the listener.
```

The listener is best-effort — a dropped connection is logged, not auto-reconnected, so the application's `reload()` remains the backstop.

#### AppConfigSourceAwsSecrets

Loads a set of AWS Secrets Manager secrets and assembles them into one config layer — the bulk-load counterpart to [`AppConfigResolverAwsSecrets`](#appconfigresolverawssecrets) (which resolves individual `${aws:…}` references). Each secret keys into the result under its name (less an optional `stripPrefix`), values are JSON-parsed, and `nameSeparator` nests dotted/slashed names into a tree.

```typescript
import { AppConfigBuilder, AppConfigSourceJson, AppConfigSourceAwsSecrets } from '@maroonedsoftware/appconfig';

// Explicit list of secrets
const source = new AppConfigSourceAwsSecrets({
  region: 'us-east-1',
  ids: ['app/prod/database', 'app/prod/port'],
  stripPrefix: 'app/prod/',
  nameSeparator: '/',
});

// Or discover every secret matching a filter
const discovered = new AppConfigSourceAwsSecrets({
  filters: [{ Key: 'name', Values: ['app/prod/'] }],
  stripPrefix: 'app/prod/',
  nameSeparator: '/',
});

const config = await new AppConfigBuilder().addSource(new AppConfigSourceJson('./config.json')).addSource(source).buildSnapshot();
```

##### AppConfigSourceAwsSecretsOptions

| Option                | Type       | Description                                                                                                  |
| --------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| `region`              | `string`   | AWS region. Optional; resolved from the AWS provider chain when omitted.                                    |
| `ids`           | `string[]` | Explicit secret ids (names or ARNs) to load. Optional; omit to discover via `ListSecrets`.                  |
| `filters`             | `Filter[]` | Filters passed to `ListSecrets` when discovering secrets. Optional; ignored when `ids` is set.        |
| `stripPrefix`         | `string`   | Removed from each secret name before it becomes a config key. Optional.                                     |
| `nameSeparator`       | `string`   | Splits derived keys into a nested object (e.g. `/`). Optional; flat keys when omitted.                       |
| `ignoreMissing` | `boolean`  | Skip individual missing secrets instead of failing the load. Optional, defaults to `false`.                 |
| `concurrency`         | `number`   | Caps concurrent batch calls during `load`. Optional; unbounded by default.                                  |

> **Cold boot:** `load()` fetches in bulk via `BatchGetSecretValue` (up to 20 secrets per call) rather than one `GetSecretValue` each, so a 100-secret boot is ~5 calls, not ~100. This requires the **`secretsmanager:BatchGetSecretValue`** IAM permission (in addition to `GetSecretValue`, which single `${aws:…}` resolution still uses). Set `concurrency` to bound the batch calls if you discover/load very many secrets.

> **Note:** `@aws-sdk/client-secrets-manager` is a peer dependency — install it alongside this package when using the AWS source or resolver.

#### AppConfigSourceGcpSecrets

The GCP counterpart to `AppConfigSourceAwsSecrets`: loads a set of Google Cloud Secret Manager secrets and assembles them into one config layer. Each secret keys into the result under its (short) id — less an optional `stripPrefix` — values are JSON-parsed, and `nameSeparator` nests dotted ids into a tree.

```typescript
import { AppConfigBuilder, AppConfigSourceGcpSecrets } from '@maroonedsoftware/appconfig';

// Explicit list of secrets
const source = new AppConfigSourceGcpSecrets('my-project', {
  ids: ['app.database', 'app.port'],
  stripPrefix: 'app.',
  nameSeparator: '.',
});

// Or discover every secret matching a filter
const discovered = new AppConfigSourceGcpSecrets('my-project', { filter: 'name:app-' });

const config = await new AppConfigBuilder().addSource(source).buildSnapshot();
```

##### AppConfigSourceGcpSecretsOptions

| Option                | Type       | Description                                                                                  |
| --------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `ids`           | `string[]` | Explicit secret ids (short names) to load. Optional; omit to discover via `listSecrets`.     |
| `filter`              | `string`   | Filter expression for `listSecrets` discovery. Optional; ignored when `ids` is set.    |
| `stripPrefix`         | `string`   | Removed from each secret id before it becomes a config key. Optional.                        |
| `nameSeparator`       | `string`   | Splits derived keys into a nested object (e.g. `.`). Optional; flat keys when omitted.        |
| `ignoreMissing` | `boolean`  | Skip individual missing secrets instead of failing the load. Optional, defaults to `false`.  |
| `concurrency`         | `number`   | Caps concurrent secret fetches during `load`. Optional; unbounded by default.                |

> The first constructor argument is the GCP project id. `@google-cloud/secret-manager` is a peer dependency. GCP has no batch API, so `load()` fetches secrets concurrently (one `accessSecretVersion` each) — already ~one round-trip of latency rather than N×; use `concurrency` to bound the fan-out if you load very many.

### Intra-config references

Enable `builder.resolveReferences()` to resolve `${ref:some.path}` tokens that point at **other values in the same merged config**. This pass runs _after_ the resolvers, so references see a tree where env/secret values are already concrete.

```typescript
const config = await new AppConfigBuilder()
  .addSource(new AppConfigSourceJson('./config.json')) // { "host": "db", "url": "${ref:host}/api", "port": 5432, "dsn": "${ref:host}:${ref:port}" }
  .resolveReferences()
  .buildSnapshot();

config.get('url'); // 'db/api'   (interpolated into the surrounding string)
config.get('dsn'); // 'db:5432'
```

Two modes are chosen automatically: a value that is **exactly one** `${ref:…}` token is substituted _by identity_ (preserving type — number, object, …), while a reference embedded in a larger string is stringified and interpolated. Paths split on `.` (numeric segments index arrays). A reference cycle, a missing path, or a non-primitive used in interpolation throws. The pass is also exported standalone as `resolveReferences(root, options?)`.

### Resolvers

#### AppConfigResolverEnv

Resolves `${env:VAR_NAME}` references against environment variables.

```typescript
// Default pattern: ${env:VAR_NAME}
const resolver = new AppConfigResolverEnv();

// Custom regex pattern
const resolver = new AppConfigResolverEnv(/\$\{([^}]+)\}/g);
```

The resolver automatically attempts to parse resolved values as JSON, so numeric and boolean environment variables are converted to their proper types.

```json
// config.json
{
  "database": {
    "host": "${env:DB_HOST}",
    "port": "${env:DB_PORT}",
    "url": "${env:DATABASE_URL}"
  }
}
```

```
# .env
DB_HOST=localhost
DB_PORT=5432
DATABASE_URL=postgres://localhost:5432/mydb
```

```typescript
const config = await new AppConfigBuilder()
  .addSource(new AppConfigSourceJson('./config.json'))
  .addSource(new AppConfigSourceDotenv('.env'))
  .addResolver(new AppConfigResolverEnv())
  .buildSnapshot();

// DB_PORT resolves to the number 5432 (JSON-parsed), not the string "5432".
```

#### AppConfigResolverGcpSecrets

Resolves `${gcp:SECRET_NAME}` references against Google Cloud Secret Manager.

```typescript
// Default pattern: ${gcp:SECRET_NAME}
const resolver = new AppConfigResolverGcpSecrets('my-project-id');

// Custom regex pattern
const resolver = new AppConfigResolverGcpSecrets('my-project-id', /\$\{secret:([^}]+)\}/g);
```

```json
// config.json
{
  "database": { "password": "${gcp:DB_PASSWORD}" },
  "api": { "key": "${gcp:API_SECRET_KEY}" }
}
```

```typescript
const config = await new AppConfigBuilder()
  .addSource(new AppConfigSourceJson('./config.json'))
  .addResolver(new AppConfigResolverGcpSecrets('my-gcp-project-id'))
  .buildSnapshot();

// ${gcp:DB_PASSWORD} fetches projects/my-gcp-project-id/secrets/DB_PASSWORD/versions/latest
```

| Parameter   | Type               | Description                                                                                  |
| ----------- | ------------------ | -------------------------------------------------------------------------------------------- |
| `projectId` | `string`           | The GCP project ID where secrets are stored                                                  |
| `prefix`    | `string \| RegExp` | Optional pattern to match secret references. Default: `/\$\{gcp:(.+)\}/g` (matches `${gcp:NAME}`) |

The resolver:

- Fetches secrets from GCP Secret Manager using the latest version
- Automatically attempts to parse secret values as JSON
- Requires valid GCP credentials (uses Application Default Credentials)
- Is decorated with `@Injectable()` for dependency injection support

> **Note:** Uses Application Default Credentials (ADC) — authenticate via `gcloud auth application-default login` or a service account. `@google-cloud/secret-manager` is a peer dependency.

#### AppConfigResolverAwsSecrets

Resolves `${aws:SECRET_ID}` references against AWS Secrets Manager (the secret id may be a name or a full ARN). The Secrets Manager I/O is delegated to [`AppConfigSourceAwsSecrets`](#appconfigsourceawssecrets), so the resolver is a thin wrapper over that source — pass a region (a default source is built for you) or share a configured source instance.

```typescript
// Default pattern: ${aws:SECRET_ID}, region from the AWS provider chain
const resolver = new AppConfigResolverAwsSecrets();

// Explicit region
const resolver = new AppConfigResolverAwsSecrets('us-east-1');

// Share one source (and its client) for both bulk-load and reference resolution
const source = new AppConfigSourceAwsSecrets({ region: 'us-east-1' });
const resolver = new AppConfigResolverAwsSecrets(source);

// Custom regex pattern
const resolver = new AppConfigResolverAwsSecrets('us-east-1', /\$\{secret:([^}]+)\}/g);
```

```json
// config.json
{
  "database": { "password": "${aws:DB_PASSWORD}" },
  "api": { "key": "${aws:API_SECRET_KEY}" }
}
```

```typescript
const config = await new AppConfigBuilder()
  .addSource(new AppConfigSourceJson('./config.json'))
  .addResolver(new AppConfigResolverAwsSecrets('us-east-1'))
  .buildSnapshot();
```

| Parameter | Type                                  | Description                                                                                       |
| --------- | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `source`  | `string \| AppConfigSourceAwsSecrets` | Optional AWS region, or a source to share. Region resolved from the AWS provider chain when omitted |
| `prefix`  | `string \| RegExp`                    | Optional pattern to match secret references. Default: `/\$\{aws:(.+)\}/g` (matches `${aws:ID}`)   |

The resolver:

- Fetches secrets from AWS Secrets Manager using the latest version (`AWSCURRENT`)
- Supports both `SecretString` and `SecretBinary` (binary is decoded as UTF-8)
- Automatically attempts to parse secret values as JSON
- Requires valid AWS credentials (uses the standard AWS provider chain)
- Is decorated with `@Injectable()` for dependency injection support

> **Note:** Credentials and the region are resolved from the standard AWS provider chain (`AWS_ACCESS_KEY_ID`/`AWS_REGION`, shared config/credentials files, or instance/task IAM roles); the `region` argument overrides the chain when provided. `@aws-sdk/client-secrets-manager` is a peer dependency.

#### AppConfigResolverPostgres

Resolves `${pg:KEY}` references against a Postgres settings table — the keyed counterpart to [`AppConfigSourcePostgres`](#appconfigsourcepostgres)'s bulk `load()`. Use it to pull individual settings inline, e.g. `apiKey: '${pg:integrations.stripe.key}'`. It does **not** query per reference: it reads from the source's bulk-loaded snapshot, so add the same source to the builder too — its one `load()` (and hot reload) fills the snapshot every `${pg:…}` reference reads. A reference to a key absent from the snapshot **throws** (unlike `load()`, which tolerates a missing table), so a misconfigured `${pg:…}` fails loud.

Because the source needs a logger and connection options, pass a constructed `AppConfigSourcePostgres` (there is no shorthand as with AWS/GCP):

```typescript
import { AppConfigBuilder, AppConfigSourceJson, AppConfigSourcePostgres, AppConfigResolverPostgres, AppConfigResolverEnv } from '@maroonedsoftware/appconfig';

const pg = new AppConfigSourcePostgres(logger, { connection: { host: 'db', port: 5432, user: 'app', password: '${env:DB_PASSWORD}', database: 'app' }, resolvers: [new AppConfigResolverEnv()] });

const config = await new AppConfigBuilder()
  .addSource(new AppConfigSourceJson('./config.json'))
  .addSource(pg) // one bulk load + hot reload populates the snapshot
  .addResolver(new AppConfigResolverPostgres(pg)) // ${pg:…} reads that snapshot — no extra queries
  .buildSnapshot();
```

> The same `AppConfigSourcePostgres` instance is added as a source (bulk-load the table, hot reload) **and** wrapped by the resolver (inline `${pg:…}` lookups) — it implements both `load()` and the keyed `get()`, and `get` reads what `load` cached. **You must add it via `addSource`** (as shown): `get` reads the load snapshot and never queries per reference, so calling it before the source is loaded throws.

## Live configuration

Configuration is always hot-reloadable. A section is injected through **one** DI token per section —
the ServerKit analog of C#'s `IOptions<T>` / `IOptionsSnapshot<T>` / `IOptionsMonitor<T>`, collapsed
into a single `AppConfigSection<T>` with three members:

| Member               | Analog                          | Value                                                              |
| -------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `.value`             | `IOptions` / `IOptionsSnapshot` | snapshot stable for the resolving scope (per request, boot at root) |
| `.current`           | `IOptionsMonitor.CurrentValue`  | the latest value, always — read at use-time                       |
| `.onChange(fn)`      | `IOptionsMonitor.OnChange`      | subscribe to changes; returns an unsubscribe function             |

A configuration section mints its own DI token by subclassing — the same one-class-per-section shape
used by `SlackConfig` and `Logger`:

```typescript
@Injectable() export abstract class SlackOptions extends AppConfigSection<SlackConfig> {}
@Injectable() export abstract class DbOptions extends AppConfigSection<DbConfig> {}
```

### Wiring with AppConfigModule

`AppConfigModule` bundles the reloadable store, the live monitors, and the per-section tokens, so a
whole app's configuration is wired in one fluent pass — the analog of a sequence of C#'s
`services.Configure<T>(configuration.GetSection("..."))` calls:

```typescript
const builder = new AppConfigBuilder().addSource(jsonSource).addResolver(awsSecrets);

const config = await AppConfigModule.create<RootConfig>(builder, logger); // logger: @maroonedsoftware/logger
config.configure('slack', SlackOptions).configure('database', DbOptions);
config.register(registry);
```

`register()` also binds the `AppConfig` token to a live view of the store, so even ad-hoc key access
(`container.get(AppConfig).getString('FEATURE_FLAG')`) observes a reload. Reach for `registerLiveAppConfig`
directly if you want that live `AppConfig` token without configuring any typed sections.

### Reloading

A config is refreshed two ways, and both run the same rebuild:

1. **Application-driven** — you call `reload()` (on the module or the store). It re-loads **every**
   source and re-runs the pipeline (resolvers, then the optional `${ref:…}` pass). This is the path for
   picking up a **rotated secret**: nothing in any source changed, but `${aws:…}`/`${gcp:…}` re-resolve.
2. **Source-driven** — a [watchable source](#self-watching-sources) signals a change and the store
   re-loads **just that source**, then rebuilds. No call needed.

Either way the rebuild is **atomic and last-good**: the new config is built fully before anything is
swapped, so a failed rebuild leaves the process on its previous values and rethrows (application-driven)
or logs (source-driven). A swap notifies every section's `onChange` and every `store.subscribe` listener.

#### Triggering a reload manually

Deciding _when_ to reload is left to the application. `reload()` rejects if the rebuild fails, so always
attach a handler — the process keeps serving the last-good config regardless.

```typescript
// On a timer — re-resolve secrets every 10 minutes so a rotation is picked up.
setInterval(
  () => void config.reload().catch(err => logger.error('config reload failed', err)),
  600_000,
);

// On a Unix signal — `kill -HUP <pid>` (or a deploy hook) forces a refresh.
process.on('SIGHUP', () => void config.reload().catch(err => logger.error('config reload failed', err)));

// From an admin endpoint / webhook (e.g. a secret-manager rotation event).
router.post('/internal/config/reload', async ctx => {
  await config.reload(); // throws → errorMiddleware renders 500, old config stays in effect
  ctx.status = 204;
});
```

`config` here is either an `AppConfigModule` (`config.reload()` delegates to the store) or an
`AppConfigStore` directly (`await builder.buildStore(logger)`).

#### Self-watching sources

Every source implements `watch(onChange)`; a source whose `watch` actually subscribes (rather than
returning a no-op disposer) triggers a reload of **just that source** when its backing store changes — no
external trigger needed. The store wires this up automatically at construction:

- **File sources** (`AppConfigSourceJson`/`Yaml`/`Dotenv`) watch the file via `fs.watch`, so editing a
  config file on disk reloads the affected layer.
- **`AppConfigSourcePostgres`** watches via `LISTEN`/`NOTIFY` when a `notifyChannel` is configured (see
  [Hot reload via `LISTEN`/`NOTIFY`](#hot-reload-via-listennotify)).

```typescript
// Edit config.json on disk → the store rebuilds and notifies subscribers, no reload() call.
const store = await new AppConfigBuilder()
  .addSource(new AppConfigSourceJson('./config.json'))
  .addResolver(new AppConfigResolverEnv())
  .buildStore<RootConfig>(logger);

store.subscribe(cfg => logger.info('config reloaded', { port: cfg.getNumber('port') }));
```

Call `store.dispose()` on shutdown to release the watchers/listeners (and clear subscribers).
`AppConfigModule` exposes the store as `config.store`.

#### Observing the current config

Three ways to read the latest value, depending on what you hold:

```typescript
// 1. A typed section token (preferred in DI) — see "Consuming a section" below.
this.options.current; // always the latest; this.options.onChange(fn) to react.

// 2. The live AppConfig token registered by AppConfigModule.register() — observes reloads too.
container.get(AppConfig).getString('FEATURE_FLAG');

// 3. The store directly, for advanced wiring.
store.current.get('database'); // snapshot in effect right now
store.subscribe(cfg => { /* run on every successful swap */ });
const live = store.toLiveConfig(); // a stable AppConfig whose reads always hit the latest
```

### Consuming a section

Inject the section token like any other service:

```typescript
@Injectable()
class SlackClient {
  constructor(private readonly options: SlackOptions) {}

  send() {
    // Read at use-time — never cache `current` in a field, or you lose live updates.
    postWebhook(this.options.current.incomingWebhookUrl);
  }
}

@Injectable()
class DbPool {
  private pool = createPool(this.options.current);

  constructor(private readonly options: DbOptions) {
    // Rebuild the pool when a credential rotates.
    this.options.onChange(async cfg => {
      const previous = this.pool;
      this.pool = createPool(cfg);
      await previous.end();
    });
  }
}
```

`onChange` fires only when a reload produces a structurally different value (a re-fetched but identical
secret is ignored), the listener may be async, and a throwing/rejecting listener is reported via the
module's logger without affecting the swap or other listeners. The returned function unsubscribes.

> **Scope note.** A section token is registered as a *scoped* service, so inject it into request-scoped
> or transient services — the common case in a Koa app, where `serverKitContextMiddleware` mints a
> scoped container per request. A long-lived singleton should read `.current` / `.onChange` (which stay
> correct in any scope) and not rely on `.value`, exactly as a C# singleton cannot consume
> `IOptionsSnapshot<T>`.

### AppConfigStore

`AppConfigModule` is the recommended entry point, but the underlying `AppConfigStore` is exported for
advanced wiring — it owns the sources/resolvers and the per-source snapshots, holds the current
`AppConfig`, rebuilds on demand (`reload()`) or when a watchable source signals, and broadcasts each
swap to subscribers. Build one directly with `await builder.buildStore<Root>(logger)`; `AppConfigModule.create()`
does this for you and exposes it as `config.store`. Call `store.dispose()` to tear down watchers.

## Utilities

### nestKeys

Transforms a flat key/value record into a nested object by splitting keys on a separator. Exported as a standalone utility for use outside of sources.

```typescript
import { nestKeys } from '@maroonedsoftware/appconfig';

nestKeys(
  {
    WEBHOOK__secret: 'abc',
    WEBHOOK__header: 'X-Sig',
    WEBHOOK__signing__algorithm: 'sha256', // deep nesting
    DATABASE_URL: 'postgres://localhost/db',
  },
  '__',
);
// →
// {
//   WEBHOOK: { secret: 'abc', header: 'X-Sig', signing: { algorithm: 'sha256' } },
//   DATABASE_URL: 'postgres://localhost/db',
// }
```

| Parameter   | Type                       | Description                                     |
| ----------- | -------------------------- | ----------------------------------------------- |
| `record`    | `Record<string, unknown>`  | The flat key/value record to transform           |
| `separator` | `string`                   | The string used to delimit path segments         |

## Custom Sources and Resolvers

### Creating a Custom Source

A source implements three methods: `load()` (the whole layer), `get(key)` (a single value — a flat id for keyed stores, or a dotted path for documents), and `watch(onChange)` (subscribe to changes). `get` is what the resolvers resolve `${scheme:KEY}` against; return `undefined` when the key is absent. A source that has nothing to watch returns a no-op disposer from `watch` — that simply opts out of hot reload.

```typescript
import { AppConfigSource } from '@maroonedsoftware/appconfig';

class MyCustomSource implements AppConfigSource {
  async load(): Promise<Record<string, unknown>> {
    // Load configuration from your custom source
    return { key: 'value' };
  }
  async get(key: string): Promise<unknown> {
    return (await this.load())[key];
  }
  watch(_onChange: () => void): () => void {
    return () => {}; // no backing store to watch — opt out of hot reload
  }
}
```

For a **file-backed** source, extend `AppConfigSourceFile` instead and implement only `parse` — it provides the missing-file guard, encoding, `fs.watch`-based `watch`, and a `get` that projects a dot-separated path into the parsed document (this is exactly how `AppConfigSourceJson`/`Yaml`/`Dotenv` are built):

```typescript
import { AppConfigSourceFile } from '@maroonedsoftware/appconfig';

class AppConfigSourceToml extends AppConfigSourceFile {
  protected parse(text: string): Record<string, unknown> {
    return parseToml(text);
  }
}
```

For a **fetch-per-key** source (secret/parameter managers, remote KV stores — anything you read one value at a time), extend `AppConfigSourceFetch` and implement `fetch` (one value) and `discover` (list ids) — it provides the explicit-list-or-discover decision, concurrent fetch (bounded by `concurrency`), `stripPrefix` keying, `nameSeparator` nesting, and the load-snapshot cache (this is how `AppConfigSourceAwsSecrets`/`GcpSecrets` are built). Override `fetchMany` to fetch in bulk where the backend supports it.

```typescript
import { AppConfigSourceFetch } from '@maroonedsoftware/appconfig';

class AppConfigSourceVault extends AppConfigSourceFetch {
  protected async fetch(id: string): Promise<unknown> {
    return this.vault.read(id);
  }
  protected async discover(): Promise<string[]> {
    return this.vault.list();
  }
}
```

### Creating a Custom Resolver

```typescript
import { AppConfigResolver } from '@maroonedsoftware/appconfig';

class MyCustomResolver implements AppConfigResolver {
  canResolve(value: string): boolean {
    return value.startsWith('custom:');
  }

  async resolve(value: string, meta): Promise<void> {
    const transformed = value.replace('custom:', '');
    (meta.owner as Record<string, unknown>)[meta.propertyPath] = transformed;
  }
}
```

The `meta` parameter is an `ObjectVisitorMeta` describing where the value lives in the configuration object (`owner`, `propertyPath`, `arrayIndex`, etc.). Mutate `meta.owner[meta.propertyPath]` (or `meta.owner[meta.arrayIndex]` for array entries) to write the transformed value back.

## Configuration Merging

When using multiple sources, configurations are deep-merged in the order they are added. Later sources override earlier ones:

```typescript
const config = await new AppConfigBuilder()
  .addSource(new AppConfigSourceJson('./defaults.json')) // Base config
  .addSource(new AppConfigSourceYaml('./config.yaml')) // Overrides defaults
  .addSource(new AppConfigSourceJson('./local.json')) // Overrides both
  .addSource(new AppConfigSourceDotenv()) // Overrides all
  .buildSnapshot();
```

## License

MIT
