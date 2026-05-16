# @maroonedsoftware/johnny5

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
