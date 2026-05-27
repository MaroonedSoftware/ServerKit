# @maroonedsoftware/johnny5

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
