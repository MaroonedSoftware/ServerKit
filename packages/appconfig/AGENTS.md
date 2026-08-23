# AGENTS.md — @maroonedsoftware/appconfig

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

Configuration assembled from layered **sources** (JSON, YAML, `.env`, HTTP, Postgres, AWS/GCP
secret managers), deep-merged, then rewritten by **resolvers** that substitute `${scheme:KEY}`
reference tokens. The result is either a one-shot immutable `AppConfig` or a hot-reloadable
`AppConfigStore` exposing typed `AppConfigSection<T>` tokens with `.value` / `.current` /
`.onChange`.

Reach for it at the composition root. Do **not** inject `AppConfig` into a service — a service
takes the already-typed section it needs, and the consumer wires `AppConfig` → typed config at
bootstrap. That rule is repo-wide; see the root AGENTS.md.

Vocabulary: a **source** loads configuration; a **resolver** substitutes references. Other
libraries call the second one a "provider"; here the two concerns stay separate.

## Install

```bash
pnpm add @maroonedsoftware/appconfig

# only for the entries you use
pnpm add yaml
pnpm add pg
pnpm add @aws-sdk/client-secrets-manager
pnpm add @google-cloud/secret-manager
```

Runtime dependencies: `@maroonedsoftware/errors`, `@maroonedsoftware/logger`, `deepmerge-ts`,
`dotenv`, `injectkit`. Everything else is an optional peer.

## Position in the graph

- **Depends on:** `errors`, `logger`.
- **Depended on by:** `koa`, `johnny5`.
- **Subpath exports:**
  - `.` — core, plus the sources and resolvers that need no extra dependency (file, JSON, dotenv,
    fetch, env).
  - `./yaml` — pulls in `yaml`.
  - `./postgres` — pulls in `pg`.
  - `./aws` — pulls in `@aws-sdk/client-secrets-manager`.
  - `./gcp` — pulls in `@google-cloud/secret-manager`.

Each backend lives behind its own entry so importing the core never statically loads a cloud SDK or
a database driver.

## API surface

### `.` — core

| Export              | Kind      | Shape                                                                                                                            | Notes                                                                                     |
| ------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `AppConfig<T>`      | class     | `new AppConfig(config: T \| (() => T))`                                                                                          | Passing a **supplier** makes every read resolve at call time — the basis for a live view. |
| `#toObject`         | method    | `() => T`                                                                                                                        | Current snapshot. Treat as read-only; mutation mutates the backing config.                |
| `#has`              | method    | `(key: keyof T) => boolean`                                                                                                      | `false` for `undefined` **and** `null`.                                                   |
| `#get`              | method    | `(key)` / `(key, defaultValue)`                                                                                                  | The default applies only when the value is missing, not merely falsy.                     |
| `#getAs<U>`         | method    | `(key: keyof T) => U`                                                                                                            | Unchecked cast.                                                                           |
| `AppConfigBuilder`  | class     | `addSource(source)`, `addResolver(resolver)`, `resolveReferences(enable = true)`, `buildSnapshot<T>()`, `buildStore<T>(logger?)` | Chainable.                                                                                |
| `AppConfigSource`   | interface | `load(): Promise<Record<string, unknown>>`, `get(key): Promise<unknown>`, `watch(onChange): () => void`                          | `get` takes a flat id or a dotted path depending on the source.                           |
| `AppConfigResolver` | interface | `canResolve(value: string): boolean`, `resolve(value, meta: ObjectVisitorMeta): Promise<void>`                                   | Rewrites in place through `meta`.                                                         |
| `buildConfigObject` | function  | `(snapshots, resolvers, resolveRefs) => Promise<Record<string, unknown>>`                                                        | The merge-then-resolve pipeline.                                                          |
| `resolveValues`     | function  | `(target: object, resolvers: AppConfigResolver[]) => Promise<void>`                                                              | The resolver pass, in place.                                                              |
| `resolveReferences` | function  | `(root: object, options?: ResolveReferencesOptions) => void`                                                                     | The intra-config `${ref:…}` pass. Default pattern `/\$\{ref:([^}]+)\}/g`.                 |
| `nestKeys`          | function  | `(record: Record<string, unknown>, separator: string) => Record<string, unknown>`                                                | Flat `A__B` keys → nested objects.                                                        |

### `.` — sources and resolvers

| Export                   | Kind  | Notes                                                                                                                                                      |
| ------------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppConfigSourceFile`    | class | Options type `AppConfigSourceFileOptions`.                                                                                                                 |
| `AppConfigSourceJson`    | class | —                                                                                                                                                          |
| `AppConfigSourceDotenv`  | class | Options type `AppConfigSourceDotenvOptions`.                                                                                                               |
| `AppConfigSourceEnv`     | class | Options type `AppConfigSourceEnvOptions`. The process environment as a layer — **not** the same thing as `AppConfigResolverEnv`. Snapshots by default.     |
| `AppConfigSourceFetch`   | class | Options type `AppConfigSourceFetchOptions`.                                                                                                                |
| `AppConfigResolverEnv`   | class | Default pattern `${env:KEY}`. **String-interpolating** — see Gotchas.                                                                                      |
| `AppConfigKeyedResolver` | class | `new AppConfigKeyedResolver(source: AppConfigSource, prefix: string \| RegExp)`. Generic `${scheme:KEY}` → `source.get(KEY)`. **Whole-value** replacement. |

### `.` — live configuration

| Export                          | Kind           | Shape                                                                                                                                  | Notes                                                                               |
| ------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `AppConfigStore<TRoot>`         | class          | `new AppConfigStore(params: AppConfigStoreParams<TRoot>)`. `current`, `reload()`, `toLiveConfig()`, `subscribe(listener)`, `dispose()` | The singleton that owns sources, resolvers, and reload.                             |
| `AppConfigStoreParams<TRoot>`   | interface      | `{ sources, resolvers, resolveRefs, snapshots, initial, logger? }`                                                                     | Usually built for you by `buildStore`.                                              |
| `AppConfigStoreListener<TRoot>` | type           | `(config: AppConfig<TRoot>) => void`                                                                                                   | —                                                                                   |
| `AppConfigSection<T>`           | abstract class | `@Injectable()`. `readonly value: T`, `readonly current: T`, `onChange(listener) => () => void`                                        | The token you subclass per section.                                                 |
| `AppConfigModule<TRoot>`        | class          | `static create(builder, logger)`, `configure(key, token)`, `register(registry)`, `reload()`, `readonly store`                          | One-call wiring. Constructor is private.                                            |
| `registerLiveAppConfig`         | function       | `<TRoot>(registry: Registry, store: AppConfigStore<TRoot>) => void`                                                                    | Registers `AppConfig` as a live view. `AppConfigModule.register` already does this. |

### `./yaml`, `./postgres`, `./aws`, `./gcp`

| Entry        | Exports                                                                                               | Default reference pattern |
| ------------ | ----------------------------------------------------------------------------------------------------- | ------------------------- |
| `./yaml`     | `AppConfigSourceYaml`                                                                                 | —                         |
| `./postgres` | `AppConfigSourcePostgres` (+ `…Options`, `…Connection`, `…Source` types), `AppConfigResolverPostgres` | `${pg:KEY}`               |
| `./aws`      | `AppConfigSourceAwsSecrets` (+ `…Options`), `AppConfigResolverAwsSecrets`                             | `${aws:KEY}`              |
| `./gcp`      | `AppConfigSourceGcpSecrets` (+ `…Options`), `AppConfigResolverGcpSecrets`                             | `${gcp:KEY}`              |

The intra-config pass uses `${ref:some.path}`, and `AppConfigResolverEnv` uses `${env:KEY}`.

### The options model

`AppConfigSection<T>` collapses C#'s `IOptions<T>` / `IOptionsSnapshot<T>` / `IOptionsMonitor<T>`
into one injectable token:

| Member      | Analog                                | Semantics                                                                                                             |
| ----------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `.value`    | `IOptionsSnapshot<T>` / `IOptions<T>` | Stable for the lifetime of the **resolving scope**. Per-request in a request scope; boot-frozen at root.              |
| `.current`  | `IOptionsMonitor<T>.CurrentValue`     | The latest value, always. Read at use time; never cache it in a field.                                                |
| `.onChange` | `IOptionsMonitor<T>.OnChange`         | Fires only when a reload produces a **structurally different** value. Listener may be async; a rejection is isolated. |

InjectKit resolves by runtime class identity and generic arguments erase, so each section declares
its own token by subclassing.

## Canonical usage

```typescript
import {
  AppConfigBuilder,
  AppConfigSourceJson,
  AppConfigSourceDotenv,
  AppConfigResolverEnv,
  AppConfigSection,
  AppConfigModule,
} from '@maroonedsoftware/appconfig';
import { AppConfigSourceYaml } from '@maroonedsoftware/appconfig/yaml';
import { AppConfigResolverGcpSecrets } from '@maroonedsoftware/appconfig/gcp';
import { Injectable } from 'injectkit';

interface RootConfig {
  slack: SlackConfig;
  database: DbConfig;
}

// One token per section
@Injectable()
abstract class SlackOptions extends AppConfigSection<SlackConfig> {}
@Injectable()
abstract class DbOptions extends AppConfigSection<DbConfig> {}

// Later sources win the deep merge
const builder = new AppConfigBuilder()
  .addSource(new AppConfigSourceYaml({ path: 'config/base.yaml' }))
  .addSource(new AppConfigSourceJson({ path: `config/${env}.json` }))
  .addSource(new AppConfigSourceDotenv({ path: '.env' }))
  .addResolver(new AppConfigResolverEnv())
  .addResolver(new AppConfigResolverGcpSecrets('my-project'))
  .resolveReferences();

const config = await AppConfigModule.create<RootConfig>(builder, logger);
config.configure('slack', SlackOptions).configure('database', DbOptions);
config.register(registry);
```

A service takes its typed section, never `AppConfig`:

```typescript
@Injectable()
class SlackService {
  constructor(private readonly options: SlackOptions) {}

  async post(text: string) {
    // .value — stable for this request
    await fetch(this.options.value.webhookUrl, { method: 'POST', body: text });
  }
}
```

For a CLI or anything without hot reload:

```typescript
const appConfig = await builder.buildSnapshot<RootConfig>();
```

See [.claude/skills/config](../../.claude/skills/config) for worked examples.

## Rules for generated code

- **Never inject `AppConfig` into a service.** Inject the typed `AppConfigSection` subclass, or
  pass the plain typed section object into the constructor at composition time.
- Declare one `AppConfigSection` subclass per section. A shared token cannot work — InjectKit keys
  on runtime class identity and the generic argument erases.
- **Section tokens are registered as scoped services.** Inject them into request-scoped or
  transient services. A singleton must read `.current` / `.onChange` and must not touch `.value`,
  exactly as a C# singleton cannot consume `IOptionsSnapshot<T>`.
- Read `.current` at use time. Caching it in a field defeats hot reload just as thoroughly as
  caching `.value` would.
- Order sources least- to most-specific. Later sources win the deep merge.
- **A containerized app needs `AppConfigSourceEnv`.** `AppConfigSourceDotenv` reads a FILE, and
  `AppConfigResolverEnv` only rewrites `${env:…}` tokens inside values somebody already wrote, so
  without the env source a variable passed to the container reaches nothing and the app falls
  through to its defaults in code, silently. Order it after the file sources.
- Import backend sources and resolvers from their subpath (`/yaml`, `/postgres`, `/aws`, `/gcp`),
  never from the root.
- Put secrets in a secret manager and reference them with `${aws:…}` / `${gcp:…}`. Do not commit a
  resolved value.
- Call `resolveReferences()` explicitly when you use `${ref:…}` — the pass is opt-in.
- Own the reload trigger yourself. The module provides `reload()`; deciding _when_ (a timer, a
  Pub/Sub message, an EventBridge event) is the application's job.
- Use `has()` rather than a truthiness check when `0`, `''`, or `false` are legitimate values.
- Call `store.dispose()` on shutdown to release source watchers.

## Gotchas

- **`.value` is frozen per scope, and that is the whole point.** Resolved from the root container it
  is the boot-time value, frozen for the process — so a singleton reading `.value` silently never
  sees a reload. This is the single most common misuse.
- **`AppConfigResolverEnv` interpolates into strings; `AppConfigKeyedResolver` replaces whole
  values.** `"${env:HOST}:${env:PORT}"` composes into one string, but `"${aws:DB}"` replaces the
  value by identity with whatever the source returned (possibly an object or a number). Mixing a
  keyed reference into a larger string does not do what it looks like.
- **A resolver's regex is force-globalised.** The constructor rewrites a non-`/g` regex to add the
  flag, because `matchAll` throws otherwise, and `canResolve` resets `lastIndex` before testing —
  without that, a `/g` regex's advancing `lastIndex` produces order-dependent false negatives.
  Preserve both behaviours in any custom resolver.
- **A source's `get` returning `undefined` leaves the reference token in place**, unresolved and
  literal, rather than erroring. Some remote-backed sources throw instead. So a typo'd secret name
  can surface as the literal string `${aws:DB_PASSWROD}` in your config.
- **`onChange` fires only on a structurally different value.** A reload that produces an identical
  config is silent, by design.
- **A failed reload leaves the current config in place and rethrows.** Config never half-applies,
  but an unhandled rejection from a watch-triggered reload only reaches the logger you passed to
  `buildStore` / `AppConfigModule.create`. Pass one.
- **Reload re-runs the _entire_ pipeline**, including every secret-manager resolver. A tight reload
  loop makes real API calls to AWS or GCP each time.
- **`get(key, default)` has deliberately intricate typing.** On a loosely-typed config the default's
  literal type is widened (`get('K', '')` is `string`, not `''`); on a typed config the declared
  type wins. If the inferred type looks wrong, check whether `T[K]` is `unknown`.
- **`toObject()` returns the live backing object, not a copy.** Mutating it mutates the config.
- **`AppConfigModule`'s constructor is private** — use `AppConfigModule.create`.
- **`buildSnapshot` gives you no reload at all.** It is for CLIs. Do not use it in a server and then
  wonder why `onChange` never fires.

## Working inside this package

```
src/
  index.ts                  Core barrel (explicit named exports, not export *)
  app.config.ts             AppConfig, WidenLiteral
  app.config.builder.ts     AppConfigBuilder
  app.config.source.ts      AppConfigSource interface
  app.config.resolver.ts    AppConfigResolver interface
  pipeline.ts               buildConfigObject — merge then resolve
  resolve.ts                resolveValues — the resolver pass
  references.ts             resolveReferences — the ${ref:…} pass
  object.visitor.ts         ObjectVisitorMeta — how a resolver writes back
  helpers.ts                tryParseJson, getByPath, structurallyEqual, nestKeys
  options/
    app.config.section.ts               AppConfigSection, AppConfigSectionImpl
    app.config.module.ts                AppConfigModule
    app.config.store.ts                 AppConfigStore and its params/listener types
    app.config.options.registration.ts  registerLiveAppConfig
  sources/     file, json, dotenv, env, fetch, yaml, postgres, aws.secrets, gcp.secrets
  resolvers/   keyed, env, postgres, aws.secrets, gcp.secrets
  yaml.ts  postgres.ts  aws.ts  gcp.ts    Subpath entries
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **Nothing reachable from `src/index.ts` may import `yaml`, `pg`, `@aws-sdk/*`, or
  `@google-cloud/*`.** That is why the four subpath entries exist.
- `src/index.ts` uses explicit named exports rather than `export *`, precisely so a new file cannot
  leak an optional-peer import into the core entry by accident. Keep it that way.
- Sections are registered **scoped** and the store is the **singleton**. `AppConfigSectionImpl` is
  created per scope but reads `current` / `onChange` through the singleton store, which is what
  makes subscriptions outlive the scope that created them.
- The `AppConfig` supplier constructor (`() => T`) is what makes `toLiveConfig` work. Every accessor
  must keep funnelling through it, or new getters will silently miss reloads.
- A failed reload must leave the previous config in place.
- `structurallyEqual` gates `onChange`. Weakening it turns every reload into a change notification.
- A new backend gets its own `src/<name>.ts` entry, an `exports` entry, a tsup entry in the `build`
  script, and its SDK under `peerDependenciesMeta` as optional.

User-visible changes need a changeset in `.changeset/`.
