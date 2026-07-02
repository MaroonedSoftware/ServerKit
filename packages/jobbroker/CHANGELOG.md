# @maroonedsoftware/jobbroker

## 1.8.0

### Minor Changes

- d5be1c1: Add deferred job enqueueing to `JobBroker.send` via an optional `JobSendOptions` argument. Pass `startAfter` as a Luxon `Duration` (relative delay) or `DateTime` (absolute earliest-run time) to defer a job instead of running it immediately. The pg-boss backend maps this onto its native `startAfter` (a `Duration` becomes relative seconds, a `DateTime` becomes an absolute `Date`); the option is expressed as intent so future backends (SQS `DelaySeconds`, Cloud Tasks `scheduleTime`) can map it too and throw `NotSupportedError` for delays they cannot honor.

### Patch Changes

- b759188: Bump shared runtime dependencies: `injectkit` to `^1.6.0` across packages, plus package-specific bumps to `zxcvbn-ts` (authentication), `@slack/web-api` (slack), `mime-types` (storage), and `prettier` (permissions-dsl).
- Updated dependencies [b759188]
  - @maroonedsoftware/logger@1.1.2

## 1.7.0

### Minor Changes

- 62e6fe1: Add job cancellation and management to `JobBroker`. `send` now returns the new job id, and the broker gains `cancel`, `resume`, `deleteJob`, and `getJob`. `cancel` stops a job whether it is still queued or already running: running jobs are cancelled cooperatively via an `AbortSignal` now passed to `Job.run(payload, signal)`, and the `PgBossJobRunner` polls for cancellation (configurable via `cancelPollIntervalSeconds`) so cancellation works across processes. Adds a normalized `JobInfo`/`JobState` and a `NotSupportedError` so alternative backends can declare unsupported operations. Backward compatible — existing handlers that ignore the signal and callers that ignore the returned id keep working.

## 1.6.0

### Minor Changes

- 4ed2f1f: Move the pg-boss backend behind a subpath export so importing the core no longer statically loads `pg-boss`. `pg-boss` is now an optional peer dependency, and the core entry (`Job`, `JobBroker`, `JobRunner`) pulls in no backend.

  Breaking: import the pg-boss classes (`PgBossJobBroker`, `PgBossJobRunner`, `PgBossJobRegistryMap`, `PgBossConnectionProvider`) from `@maroonedsoftware/jobbroker/pgboss` instead of the package root.

## 1.5.0

### Minor Changes

- a9bdcba: Support transactional job enqueue via a `PgBossConnectionProvider`. `PgBossJobBroker` now sources the pg-boss `db` executor for each `send`/`schedule` from an injected `PgBossConnectionProvider`, so overriding it in a request scope (e.g. with pg-boss's `fromKysely(trx)`) enqueues jobs atomically with the surrounding transaction. The default provider preserves existing pooled behavior. BREAKING: `PgBossJobBroker` now requires a `PgBossConnectionProvider` constructor argument — register `PgBossConnectionProvider` in your DI container.

## 1.4.3

### Patch Changes

- a167ee3: Bump runtime dependencies (notably `injectkit` to 1.4.1) and relax the pgboss job registration type guard so it accepts the updated `Identifier` shape.
- Updated dependencies [a167ee3]
  - @maroonedsoftware/logger@1.1.1

## 1.4.2

### Patch Changes

- 108c1d4: Cross-package security and correctness audit.
  - **authentication**: `JwtAuthenticationIssuer.parse` now receives both the raw `token` and the decoded `payload` (was just `payload`) — implementations **must** verify the signature against trusted key material because the payload is unverified. `JwtProvider` accepts an optional `pemPublicKey` and now verifies tokens with the public key (derived from the private PEM when not supplied) so verification paths never have to hold the signing key. `updateSession` resets `expiresAt` to `now + expiration` (absolute) instead of stacking it on top of the existing expiry — a chatty client can no longer extend a session past its configured lifetime. FIDO assertion verification rejects factors that are missing their replay counter instead of silently degrading to "no counter check". Magic-link redirect HTML now embeds the URL via `JSON.stringify` so the assignment string cannot be escaped. Authorization-header parsing splits on the first space only, preserving multi-token credentials such as `Digest username="…", nonce="…"`.
  - **encryption**: `EncryptionProvider.createKey` is now `async` and derives keys with **Argon2id** (the OWASP-recommended memory-hard KDF, shared with `Argon2idPasswordHashProvider` via the new `ARGON2ID_DEFAULTS` export) instead of PBKDF2-HMAC-SHA512 at 65 535 iterations. Callers must `await` and any keys previously derived from a passphrase will no longer match — re-derive and re-encrypt. The per-id lock chain inside `InMemoryKmsProvider` was rewritten with `async`/`await`, fixing a `prev.then(fn, fn)` bug that broke serialisation when a queued operation rejected. Removed an unreachable `KeyRetiredError` guard on the encrypt path. `kms/in-memory.kms.provider.ts` renamed to `kms/in.memory.kms.provider.ts` to match the project's dot-separated filename convention — deep imports must update the path.
  - **errors**: The `@OnError` decorator now **rethrows** the original error after invoking the handler. Handlers that map errors continue to work (they throw their replacement, which short-circuits the rethrow); handlers that only logged and swallowed will start propagating errors. `isPostgresError` is stricter — it requires `code` to be a string in the 5-character SQLSTATE shape, so generic Node errors (`ENOENT`, axios errors with a `code`, etc.) are no longer mis-routed through the Postgres mapper.
  - **appconfig**: `AppConfigProviderGcpSecrets.getSecret` now throws a `ServerkitError` (with the original error attached as `cause` and `secretId` / `projectId` in `internalDetails`) when Secret Manager rejects, instead of silently substituting `''` and booting the service with empty passwords / API keys. `canParse` resets the regex's `lastIndex` before testing, fixing a stateful-`/g`-flag bug that returned `false` for matching strings on subsequent calls. `AppConfigBuilder.build()` now returns an empty config when no sources are registered instead of crashing on `deepmerge()` of zero arguments. Added a workspace dependency on `@maroonedsoftware/errors`.
  - **jobbroker**: `PgBossJobRunner` now `await`s `pgboss.work(...)` and wraps the per-batch job execution in `Promise.allSettled`, so pg-boss no longer marks a batch complete before the jobs have actually finished. Each job in a batch now resolves its own `Job` instance from the DI container, matching the documented "resolved for each execution" contract.
  - **koa**: `requireSignature` middleware compares HMAC digests with `crypto.timingSafeEqual` (with a length guard for missing/short signatures) instead of `!==`, removing a timing-attack vector on webhook signatures.
  - **scim**: `ScimUserService` and `ScimGroupService` use Luxon `DateTime.utc().toISO()` for `meta.created` / `meta.lastModified` instead of native `Date#toISOString()`, matching the project-wide Luxon convention.

## 1.4.1

### Patch Changes

- 9e2c2de: chore: update package versions for dependencies and devDependencies
  - @maroonedsoftware/logger@1.1.0

## 1.4.0

### Minor Changes

- d7c5735: Call and await this.pgboss.start() at the beginning of PgBossJobRunner.start() to ensure the pgboss instance is running before calling getQueue/createQueue.

## 1.3.0

### Minor Changes

- 922f585: upgrading to typescript 6

### Patch Changes

- Updated dependencies [922f585]
  - @maroonedsoftware/logger@1.1.0

## 1.2.0

### Minor Changes

- 5ded700: updating tests

## 1.1.0

### Minor Changes

- dc9e6d1: update packages
- 337289b: adding authentication package and middleware, this is mostly stubs to prep for future work

### Patch Changes

- @maroonedsoftware/logger@1.0.0

## 1.0.0

### Major Changes

- 2d69860: Initial release

### Patch Changes

- Updated dependencies [2d69860]
  - @maroonedsoftware/logger@1.0.0
