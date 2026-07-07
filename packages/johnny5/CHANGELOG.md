# @maroonedsoftware/johnny5

## 6.0.1

### Patch Changes

- Updated dependencies [dc2a24b]
  - @maroonedsoftware/koa@2.7.1

## 6.0.0

### Patch Changes

- Updated dependencies [de7fef3]
- Updated dependencies [f83e58e]
  - @maroonedsoftware/koa@2.7.0

## 5.0.0

### Patch Changes

- dfe5304: Security and robustness hardening across the workspace.

  - **appconfig**: reject `__proto__`/`constructor`/`prototype` key segments in `nestKeys` (prototype-pollution guard), isolate config-change listener errors so one throwing listener can't abort a reload, replace arrays on deep-merge (last-wins) instead of concatenating, and make secret/env resolver prefixes non-greedy and always global.
  - **authentication**: atomically claim the refresh-token `jti` (via the new `CacheProvider.add`) to close a refresh-reuse race, pin JWT verification to `RS256`, bound failed OTP/code attempts on the authenticator/email/phone factors (new `maxValidationAttempts`/`maxVerificationAttempts` options, HTTP 429 when exceeded), and split Basic credentials on the first colon only.
  - **cache**: add `CacheProvider.add` (atomic set-if-absent claim primitive) and make `update` apply `XX` so an expired key is not resurrected without a TTL.
  - **discord/slack/telegram/whatsapp**: add a per-request `requestTimeoutMs` (default 10s), redact secret tokens from REST-client logs, and neutralize `@everyone`/`@here`/broadcast mentions in outgoing text. Discord additionally acks multi-reply interactions out of band.
  - **koa**: reject `origin: '*'` combined with `credentials: true`, honor an inbound `X-Request-Id`, bound the binary parser body (new `BinaryParserOptions`, 20MB default, HTTP 413), and resolve wildcard media-type registrations (e.g. `application/*+json`).
  - **multipart**: bound field/parts counts by default (`MAX_FIELDS`/`MAX_PARTS`) so a field flood cannot exhaust memory.
  - **errors**: map Postgres foreign-key violations (23503) to HTTP 409 Conflict instead of 404.
  - **scim**: enforce `userName` required and unique on user PATCH (400/409).
  - **permissions-dsl**: reject reserved namespace names (JS keywords, permission builders, the `model` export) that would otherwise generate uncompilable output.
  - **utilities**: accept UUID versions 6/7/8 in `isUuid`.
  - **storage**: write files atomically (temp file + rename) so a mid-write crash can't leave a truncated file readable as complete.
  - **jobbroker**: reject the pg-boss work handler when a job in the batch fails so retry/dead-letter policies actually apply.
  - **johnny5**: strip dotenv inline comments on unquoted values without corrupting quoted ones.
  - **zod**: fall back to a stable message for issue codes that carry none.

- Updated dependencies [dfe5304]
- Updated dependencies [dfe5304]
  - @maroonedsoftware/logger@1.1.3
  - @maroonedsoftware/permissions@0.2.3
  - @maroonedsoftware/appconfig@2.2.0
  - @maroonedsoftware/koa@2.6.0
  - @maroonedsoftware/permissions-dsl@0.5.0

## 4.0.1

### Patch Changes

- Updated dependencies [b00d9b4]
  - @maroonedsoftware/permissions-dsl@0.4.3
  - @maroonedsoftware/appconfig@2.1.2
  - @maroonedsoftware/koa@2.5.1

## 4.0.0

### Patch Changes

- b759188: Bump shared runtime dependencies: `injectkit` to `^1.6.0` across packages, plus package-specific bumps to `zxcvbn-ts` (authentication), `@slack/web-api` (slack), `mime-types` (storage), and `prettier` (permissions-dsl).
- Updated dependencies [b759188]
- Updated dependencies [b759188]
  - @maroonedsoftware/appconfig@2.1.1
  - @maroonedsoftware/logger@1.1.2
  - @maroonedsoftware/permissions@0.2.2
  - @maroonedsoftware/permissions-dsl@0.4.2
  - @maroonedsoftware/koa@2.5.0

## 3.0.5

### Patch Changes

- Updated dependencies [af20061]
  - @maroonedsoftware/appconfig@2.1.0
  - @maroonedsoftware/koa@2.4.5

## 3.0.4

### Patch Changes

- Updated dependencies [bae9e10]
  - @maroonedsoftware/appconfig@2.0.0
  - @maroonedsoftware/koa@2.4.4

## 3.0.3

### Patch Changes

- Updated dependencies [c8f0fa4]
  - @maroonedsoftware/appconfig@1.9.0
  - @maroonedsoftware/koa@2.4.3

## 3.0.2

### Patch Changes

- Updated dependencies [75e4ce2]
  - @maroonedsoftware/appconfig@1.8.1
  - @maroonedsoftware/koa@2.4.2

## 3.0.1

### Patch Changes

- Updated dependencies [54af043]
  - @maroonedsoftware/appconfig@1.8.0
  - @maroonedsoftware/koa@2.4.1

## 3.0.0

### Patch Changes

- Updated dependencies [950477d]
  - @maroonedsoftware/koa@2.4.0

## 2.1.0

### Minor Changes

- c4100f8: Add a `@maroonedsoftware/johnny5/bin` subpath exporting `runTypescriptBin` / `registerTypescriptLoader` — a TypeScript bin shim that anchors the `@swc-node/register` ESM loader to the bin file (cwd-independent), points `SWC_NODE_PROJECT` at the package tsconfig, and narrowly suppresses Node 26's DEP0205 deprecation warning around `module.register()`.

  Fix `postgresReachable()` and `redisReachable()` so they work without an AppConfig passed to `createCliApp`. `AppConfig` coerces missing keys to the string `'undefined'` / `NaN` instead of throwing, so the documented `process.env` fallback never fired — postgres connected to a bogus host instead of using `process.env.DATABASE_URL`, and redis attempted `undefined:NaN` instead of defaulting to `localhost:6379`. Both checks now read raw config values at check run time, accept them only when genuinely usable, and fall back to env vars (then defaults for redis).

  Harden `buildContext`'s env-file loading: a `.env` that exists but can't be read (EPERM/EACCES from permissions or sandboxes) no longer crashes the CLI before any command runs — it's skipped with a logged warning.

## 2.0.0

### Minor Changes

- 3422e87: Replace native JS `Date` with Luxon `DateTime` throughout, per the repo's date/time convention. Native `Date` now appears only at true interop boundaries (e.g. converting a third-party adapter's `Date` with `DateTime.fromJSDate`).

  **Breaking — `@maroonedsoftware/authentication`:** OAuth 2.0 / OIDC token and factor types now use `DateTime` instead of `Date`:
  - `OAuth2Tokens.expiresAt` is now `DateTime | undefined`. Adapters implementing `OAuth2ProviderClient` must convert at the boundary — e.g. `DateTime.fromJSDate(arcticTokens.accessTokenExpiresAt())`.
  - `OAuth2FactorValue.refreshTokenExpiresAt`, `OidcFactorValue.refreshTokenExpiresAt`, and the `updateRefreshToken(...)` `refreshTokenExpiresAt` argument are now `DateTime` (optional; omit for a non-expiring refresh token, where the type was previously `Date | null`). Repository implementations that persist to a `timestamptz` column should call `.toJSDate()` on write and `DateTime.fromJSDate(...)` on read.
  - `OAuth2FactorService.refreshAccessToken(...)` now resolves `expiresAt?: DateTime` (was `Date | null`).

  **Breaking — `@maroonedsoftware/johnny5`:** `DaemonStatus.startedAt` is now a `DateTime` (was `Date`). The on-disk pid record is unchanged (still an ISO string).

  `@maroonedsoftware/encryption`, `@maroonedsoftware/koa`, and `@maroonedsoftware/slack` change only internal time computations (KMS decrypt-audit timestamp, rate-limit reset header, Slack signature default `now`); no public API change. `luxon` is added as a runtime dependency to `encryption`, `johnny5`, and `koa`.

### Patch Changes

- Updated dependencies [3422e87]
- Updated dependencies [3422e87]
  - @maroonedsoftware/koa@2.3.0

## 1.2.9

### Patch Changes

- Updated dependencies [1106274]
  - @maroonedsoftware/appconfig@1.7.0
  - @maroonedsoftware/koa@2.2.16

## 1.2.8

### Patch Changes

- Updated dependencies [a0e9bd2]
  - @maroonedsoftware/appconfig@1.6.0
  - @maroonedsoftware/koa@2.2.15

## 1.2.7

### Patch Changes

- @maroonedsoftware/koa@2.2.14

## 1.2.6

### Patch Changes

- @maroonedsoftware/koa@2.2.13

## 1.2.5

### Patch Changes

- @maroonedsoftware/koa@2.2.12

## 1.2.4

### Patch Changes

- @maroonedsoftware/koa@2.2.11

## 1.2.3

### Patch Changes

- @maroonedsoftware/koa@2.2.10

## 1.2.2

### Patch Changes

- @maroonedsoftware/koa@2.2.9

## 1.2.1

### Patch Changes

- @maroonedsoftware/koa@2.2.8

## 1.2.0

### Minor Changes

- eef8918: Add `wizard` session wrapper and an optional `@maroonedsoftware/johnny5/keyring` subpath.

  `wizard(ctx, options, body)` runs a multi-step interactive flow with uniform intro/outro framing and cancel handling. The session passed to `body` exposes `confirm` / `text` / `password` / `select` / `multiselect` (plus `log` and `spinner` pass-throughs) whose answers are already unwrapped — cancellation throws `PromptCancelledError`, which the wrapper catches and renders as a configurable cancel outro plus exit code. Eliminates the `if (clack.isCancel(x)) { clack.outro('aborted'); return 1; }` boilerplate that piles up in every guided command.

  `@maroonedsoftware/johnny5/keyring` ships `keyringEntry(ctx, { service, account })` for safe read/write/delete against the OS keyring, plus `resolveSecret(ctx, options)` which codifies the override → env → keyring → prompt resolution chain. The peer dependency on `@napi-rs/keyring` is optional and lazy-loaded — CLIs that don't need keyring access pay no install or bundle cost, and CLIs that do degrade gracefully (logging a one-shot warning and returning `null` / `false`) when the native module isn't installed. `resolveSecret` never calls `process.exit`; callers own the missing-credential policy.

### Patch Changes

- @maroonedsoftware/koa@2.2.7

## 1.1.2

### Patch Changes

- @maroonedsoftware/koa@2.2.6

## 1.1.1

### Patch Changes

- a167ee3: Bump runtime dependencies (notably `injectkit` to 1.4.1) and relax the pgboss job registration type guard so it accepts the updated `Identifier` shape.
- Updated dependencies [a167ee3]
  - @maroonedsoftware/appconfig@1.5.1
  - @maroonedsoftware/koa@2.2.5
  - @maroonedsoftware/logger@1.1.1
  - @maroonedsoftware/permissions@0.2.1
  - @maroonedsoftware/permissions-dsl@0.4.1

## 1.1.0

### Minor Changes

- 3fe60fd: Add detached-process support to johnny5:
  - `Shell.runDetached(command, args, { logFile?, cwd?, env? })` — low-level primitive that spawns a child with `detached: true` + `unref()`, optionally appending stdout/stderr to a log file. Returns `{ pid, logFile }` immediately so the CLI process can exit.
  - `ctx.daemons` — project-scoped manager built on `runDetached`. Owns pid- and log-file conventions: `start` is idempotent (`onExisting: 'reuse' | 'restart' | 'error'`), `stop` sends a signal and cleans the pid file, `status` and `list` read the on-disk records and verify liveness via `process.kill(pid, 0)`. Daemon names must match `/^[A-Za-z0-9._-]+$/`. `createDaemons` accepts an optional `paths` override (`JohnnyPaths`) for tests and consumers that need an isolated runtime/log location.
  - `johnnyPaths(app)` — returns OS-native `{ log, runtime, cache }` dirs (macOS `~/Library/Logs|Caches`, Linux XDG, Windows `%LOCALAPPDATA%`).
  - `projectSlug(projectRoot)` — `<basename>-<8charHash>` slug used to scope pid/log dirs per checkout, so two clones of the same repo don't collide.

  Pid files live under `<johnnyPaths.runtime>/<slug>/`, logs under `<johnnyPaths.log>/<slug>/`.

## 1.0.3

### Patch Changes

- @maroonedsoftware/koa@2.2.4

## 1.0.2

### Patch Changes

- Updated dependencies [108c1d4]
  - @maroonedsoftware/appconfig@1.5.0
  - @maroonedsoftware/koa@2.2.3

## 1.0.1

### Patch Changes

- @maroonedsoftware/koa@2.2.2

## 1.0.0

### Minor Changes

- caa2438: Add declarative safety guards to `CommandModule`:
  - `dangerous: true` (or `{ confirm: 'typed', phrase, message }`) marks a command as destructive. johnny5 auto-injects a `-y, --yes` flag (skipped when one is already declared), prompts the user in TTY contexts, requires `--yes` in non-interactive contexts, and supports a typed-phrase confirmation mode for the most dangerous operations.
  - `allowedEnvironments: ['development', 'staging']` (or the spec form `{ allowed, variable }`) refuses to run when the configured env variable falls outside the allowed list. Defaults to reading `NODE_ENV`. The env guard runs before the dangerous prompt, so misconfigured environments fail fast.

  `DangerousSpec` and `EnvironmentGuardSpec` are now exported from the package root for callers that want to type these specs themselves.

- caa2438: Add two new doctor-check subpaths to `@maroonedsoftware/johnny5`:
  - `@maroonedsoftware/johnny5/permissions` — `permissionsSchemaCompiled` checks `.perm` sources are in sync with the generated TypeScript (with `--fix` autoFix that runs the real compile), `permissionsFixturesPass` runs every matched `*.perm.yaml` fixture's assertions, and `permissionsModelLoads` surfaces `AuthorizationModel` constructor errors at doctor time.
  - `@maroonedsoftware/johnny5/kysely` — `kyselyTableExists` asks Kysely's introspection API whether a migration-managed table is present (useful for the permissions tuples table, the jobs table, etc.).

  Both subpaths declare their drivers as optional peer deps and lazy-load them so the import cost is paid only by consumers that wire the check up.

  In support of these checks, `@maroonedsoftware/permissions-dsl`'s `compile()` now accepts `{ dryRun: true }` — the full parse/validate/codegen pipeline still runs and `CompileResult` is populated as if the writes had happened, but no files are written, no orphans are removed, and the cache manifest is not mutated. Lets callers detect drift between `.perm` sources and generated TypeScript without touching disk.

### Patch Changes

- Updated dependencies [caa2438]
  - @maroonedsoftware/permissions-dsl@0.4.0

## 0.1.0

### Minor Changes

- 45f0294: Add @maroonedsoftware/johnny5 — a CLI framework for ServerKit-based applications. Provides `createCliApp` for assembling a commander-backed program from declarative `CommandModule` definitions, a built-in doctor runner with auto-remediation hooks, workspace-package plugin discovery (via a top-level `"johnny5"` field in each plugin's `package.json`), and opt-in integrations (Postgres, Redis, Docker, version checks, filesystem checks, ServerKit DI bootstrap) exposed as subpath exports.
