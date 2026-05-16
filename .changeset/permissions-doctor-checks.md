---
'@maroonedsoftware/johnny5': minor
'@maroonedsoftware/permissions-dsl': minor
---

Add two new doctor-check subpaths to `@maroonedsoftware/johnny5`:

- `@maroonedsoftware/johnny5/permissions` — `permissionsSchemaCompiled` checks `.perm` sources are in sync with the generated TypeScript (with `--fix` autoFix that runs the real compile), `permissionsFixturesPass` runs every matched `*.perm.yaml` fixture's assertions, and `permissionsModelLoads` surfaces `AuthorizationModel` constructor errors at doctor time.
- `@maroonedsoftware/johnny5/kysely` — `kyselyTableExists` asks Kysely's introspection API whether a migration-managed table is present (useful for the permissions tuples table, the jobs table, etc.).

Both subpaths declare their drivers as optional peer deps and lazy-load them so the import cost is paid only by consumers that wire the check up.

In support of these checks, `@maroonedsoftware/permissions-dsl`'s `compile()` now accepts `{ dryRun: true }` — the full parse/validate/codegen pipeline still runs and `CompileResult` is populated as if the writes had happened, but no files are written, no orphans are removed, and the cache manifest is not mutated. Lets callers detect drift between `.perm` sources and generated TypeScript without touching disk.
