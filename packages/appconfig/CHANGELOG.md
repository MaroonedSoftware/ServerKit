# @maroonedsoftware/appconfig

## 2.1.2

### Patch Changes

- Updated dependencies [b00d9b4]
  - @maroonedsoftware/errors@1.7.1

## 2.1.1

### Patch Changes

- b759188: Bump shared runtime dependencies: `injectkit` to `^1.6.0` across packages, plus package-specific bumps to `zxcvbn-ts` (authentication), `@slack/web-api` (slack), `mime-types` (storage), and `prettier` (permissions-dsl).
- Updated dependencies [b759188]
  - @maroonedsoftware/logger@1.1.2

## 2.1.0

### Minor Changes

- af20061: Move the Postgres, YAML, and AWS/GCP secret-manager backends behind subpath exports so importing the core no longer statically loads `pg`, `yaml`, or the cloud SDKs. Previously importing anything from `@maroonedsoftware/appconfig` eagerly required all four, forcing every consumer to install them even to read a JSON or dotenv file; they are now optional peer dependencies.

  Breaking: import these from their subpaths instead of the package root —

  - `@maroonedsoftware/appconfig/postgres` — `AppConfigSourcePostgres`, `AppConfigResolverPostgres`
  - `@maroonedsoftware/appconfig/yaml` — `AppConfigSourceYaml`
  - `@maroonedsoftware/appconfig/aws` — `AppConfigSourceAwsSecrets`, `AppConfigResolverAwsSecrets`
  - `@maroonedsoftware/appconfig/gcp` — `AppConfigSourceGcpSecrets`, `AppConfigResolverGcpSecrets`

  The core entry (file/JSON/dotenv/fetch sources, the env resolver, live-config wiring) is unchanged.

## 2.0.0

### Major Changes

- bae9e10: Restructure configuration around **sources** (load a layer) and **resolvers** (substitute `${scheme:…}` reference tokens). Breaking changes:

  - "Providers" are renamed to "resolvers": `AppConfigProvider*` → `AppConfigResolver*` (`Env` / `AwsSecrets` / `GcpSecrets` / `Postgres`, plus the `AppConfigResolver` interface and `AppConfigKeyedResolver` base).
  - Secret/file/remote loading moves into dedicated sources: `AppConfigSourceFile` (base for `Json` / `Yaml` / `Dotenv`), `AppConfigSourceFetch` (base for `AwsSecrets` / `GcpSecrets`), and `AppConfigSourcePostgres` (file renamed to `app.config.source.postgres.ts`).
  - Live configuration is wired through `AppConfigModule` and `AppConfigSection` over a reloadable `AppConfigStore`, replacing the previous options manager/monitor.
  - `AppConfigBuilder` now exposes `buildSnapshot()` (one-shot, immutable) and `buildStore()` (hot-reloadable) instead of a single `build()`, and the pipeline passes are exported standalone: `buildConfigObject`, `resolveValues`, `resolveReferences`.

## 1.9.0

### Minor Changes

- c8f0fa4: Add `AppConfigPostgresSource`, a configuration source that loads key/value rows from a Postgres table (configurable schema, table, and key/value columns). Connection parameters and schema are supplied via the injectable `AppConfigPostgresSourceOptions`. `pg` is a new optional peer dependency.

## 1.8.1

### Patch Changes

- 75e4ce2: Fix `AppConfig.get(key, defaultValue)` returning `{}` instead of the default value's type on loosely-typed configs (e.g. `Record<string, unknown>`). The default value's type is now preserved, so `config.get('KEY', 'fallback')` is typed as `string`.

## 1.8.0

### Minor Changes

- 54af043: Add `AppConfig.has(key)` to check whether a value is present (not `undefined` or `null`), and a `get(key, defaultValue)` overload that falls back only when the stored value is missing — not when it is merely falsy.

## 1.7.0

### Minor Changes

- 1106274: Add live configuration support: an `AppConfigStore` that rebuilds the config on demand (e.g. when a secret rotates) and swaps it in only on a successful rebuild, plus an `IOptions`-style accessor trio — `AppConfigOptions<T>` (static boot snapshot), `AppConfigOptionsSnapshot<T>` (per-request scoped), and `AppConfigOptionsMonitor<T>` (live singleton with `.current` and `onChange`). `AppConfigOptionsManager` keeps the monitors in sync with the store, and `registerAppConfigOptions` wires the tiers into an InjectKit registry following the existing class-token convention. `onChange` listeners may be async, are skipped for structurally-identical reloads, and have their failures reported via `@maroonedsoftware/logger` (a new workspace dependency) without affecting the swap or other listeners.

## 1.6.0

### Minor Changes

- a0e9bd2: Add `AppConfigProviderAwsSecrets`, a provider that resolves `${aws:SECRET_ID}` references against AWS Secrets Manager. Mirrors the GCP provider: an optional `region` (resolved from the standard AWS provider chain when omitted) and an optional `prefix` regex. Supports both `SecretString` and `SecretBinary` secrets, attempts to JSON-parse resolved values, and throws a `ServerkitError` (rather than silently substituting an empty string) when a secret cannot be resolved. Requires the new `@aws-sdk/client-secrets-manager` peer dependency.

## 1.5.1

### Patch Changes

- a167ee3: Bump runtime dependencies (notably `injectkit` to 1.4.1) and relax the pgboss job registration type guard so it accepts the updated `Identifier` shape.

## 1.5.0

### Minor Changes

- 108c1d4: Cross-package security and correctness audit.
  - **authentication**: `JwtAuthenticationIssuer.parse` now receives both the raw `token` and the decoded `payload` (was just `payload`) — implementations **must** verify the signature against trusted key material because the payload is unverified. `JwtProvider` accepts an optional `pemPublicKey` and now verifies tokens with the public key (derived from the private PEM when not supplied) so verification paths never have to hold the signing key. `updateSession` resets `expiresAt` to `now + expiration` (absolute) instead of stacking it on top of the existing expiry — a chatty client can no longer extend a session past its configured lifetime. FIDO assertion verification rejects factors that are missing their replay counter instead of silently degrading to "no counter check". Magic-link redirect HTML now embeds the URL via `JSON.stringify` so the assignment string cannot be escaped. Authorization-header parsing splits on the first space only, preserving multi-token credentials such as `Digest username="…", nonce="…"`.
  - **encryption**: `EncryptionProvider.createKey` is now `async` and derives keys with **Argon2id** (the OWASP-recommended memory-hard KDF, shared with `Argon2idPasswordHashProvider` via the new `ARGON2ID_DEFAULTS` export) instead of PBKDF2-HMAC-SHA512 at 65 535 iterations. Callers must `await` and any keys previously derived from a passphrase will no longer match — re-derive and re-encrypt. The per-id lock chain inside `InMemoryKmsProvider` was rewritten with `async`/`await`, fixing a `prev.then(fn, fn)` bug that broke serialisation when a queued operation rejected. Removed an unreachable `KeyRetiredError` guard on the encrypt path. `kms/in-memory.kms.provider.ts` renamed to `kms/in.memory.kms.provider.ts` to match the project's dot-separated filename convention — deep imports must update the path.
  - **errors**: The `@OnError` decorator now **rethrows** the original error after invoking the handler. Handlers that map errors continue to work (they throw their replacement, which short-circuits the rethrow); handlers that only logged and swallowed will start propagating errors. `isPostgresError` is stricter — it requires `code` to be a string in the 5-character SQLSTATE shape, so generic Node errors (`ENOENT`, axios errors with a `code`, etc.) are no longer mis-routed through the Postgres mapper.
  - **appconfig**: `AppConfigProviderGcpSecrets.getSecret` now throws a `ServerkitError` (with the original error attached as `cause` and `secretId` / `projectId` in `internalDetails`) when Secret Manager rejects, instead of silently substituting `''` and booting the service with empty passwords / API keys. `canParse` resets the regex's `lastIndex` before testing, fixing a stateful-`/g`-flag bug that returned `false` for matching strings on subsequent calls. `AppConfigBuilder.build()` now returns an empty config when no sources are registered instead of crashing on `deepmerge()` of zero arguments. Added a workspace dependency on `@maroonedsoftware/errors`.
  - **jobbroker**: `PgBossJobRunner` now `await`s `pgboss.work(...)` and wraps the per-batch job execution in `Promise.allSettled`, so pg-boss no longer marks a batch complete before the jobs have actually finished. Each job in a batch now resolves its own `Job` instance from the DI container, matching the documented "resolved for each execution" contract.
  - **koa**: `requireSignature` middleware compares HMAC digests with `crypto.timingSafeEqual` (with a length guard for missing/short signatures) instead of `!==`, removing a timing-attack vector on webhook signatures.
  - **scim**: `ScimUserService` and `ScimGroupService` use Luxon `DateTime.utc().toISO()` for `meta.created` / `meta.lastModified` instead of native `Date#toISOString()`, matching the project-wide Luxon convention.

### Patch Changes

- Updated dependencies [108c1d4]
  - @maroonedsoftware/errors@1.7.0

## 1.4.1

### Patch Changes

- 9e2c2de: chore: update package versions for dependencies and devDependencies

## 1.4.0

### Minor Changes

- 922f585: upgrading to typescript 6

## 1.3.0

### Minor Changes

- 64fdc6c: adding group nesting keys to appconfig dotenv

## 1.2.0

### Minor Changes

- 5ded700: adding getAs function to appconfig

## 1.1.0

### Minor Changes

- dc9e6d1: update packages

## 1.0.0

### Major Changes

- 2d69860: Initial release
