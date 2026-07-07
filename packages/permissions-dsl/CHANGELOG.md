# @maroonedsoftware/permissions-dsl

## 0.5.0

### Minor Changes

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

### Patch Changes

- Updated dependencies [dfe5304]
  - @maroonedsoftware/permissions@0.2.3

## 0.4.3

### Patch Changes

- b00d9b4: Reduce cyclomatic/cognitive complexity in three internal hotspots with no change to public behavior: `PostgresErrorHandler` now maps SQLSTATE codes via a lookup table instead of a large switch, and `permissions-dsl`'s `compile` and reference-validation pass are split into focused, single-responsibility helpers.

## 0.4.2

### Patch Changes

- b759188: Bump shared runtime dependencies: `injectkit` to `^1.6.0` across packages, plus package-specific bumps to `zxcvbn-ts` (authentication), `@slack/web-api` (slack), `mime-types` (storage), and `prettier` (permissions-dsl).
- Updated dependencies [b759188]
  - @maroonedsoftware/permissions@0.2.2

## 0.4.1

### Patch Changes

- a167ee3: Bump runtime dependencies (notably `injectkit` to 1.4.1) and relax the pgboss job registration type guard so it accepts the updated `Identifier` shape.
- Updated dependencies [a167ee3]
  - @maroonedsoftware/permissions@0.2.1

## 0.4.0

### Minor Changes

- caa2438: Add two new doctor-check subpaths to `@maroonedsoftware/johnny5`:
  - `@maroonedsoftware/johnny5/permissions` — `permissionsSchemaCompiled` checks `.perm` sources are in sync with the generated TypeScript (with `--fix` autoFix that runs the real compile), `permissionsFixturesPass` runs every matched `*.perm.yaml` fixture's assertions, and `permissionsModelLoads` surfaces `AuthorizationModel` constructor errors at doctor time.
  - `@maroonedsoftware/johnny5/kysely` — `kyselyTableExists` asks Kysely's introspection API whether a migration-managed table is present (useful for the permissions tuples table, the jobs table, etc.).

  Both subpaths declare their drivers as optional peer deps and lazy-load them so the import cost is paid only by consumers that wire the check up.

  In support of these checks, `@maroonedsoftware/permissions-dsl`'s `compile()` now accepts `{ dryRun: true }` — the full parse/validate/codegen pipeline still runs and `CompileResult` is populated as if the writes had happened, but no files are written, no orphans are removed, and the cache manifest is not mutated. Lets callers detect drift between `.perm` sources and generated TypeScript without touching disk.

## 0.3.0

### Minor Changes

- a1c1cac: permissions-dsl: cache compiled outputs, improve diagnostics, and grow the playground UX in the VSCode extension
  - The compiler now stores a manifest under `<rootDir>/node_modules/.cache/pdsl/` (configurable via `cacheDir` in `permissions.config.json`) and skips re-rendering namespaces whose source and visible-namespace set are unchanged. Cache invalidates on compiler version bump or any `output` / `permissionsImport` / `prettier` change.
  - Compile errors are now collected across files and surfaced together as `AggregateCompileError`, instead of failing fast on the first file.
  - Generated TypeScript files whose source namespace no longer exists are removed automatically on the next compile (orphan cleanup).
  - New `validateFile()` helper performs the parse + sibling-merge + lower flow used by the compiler. The VSCode extension language server now calls it instead of re-implementing the pipeline inline.
  - `CompileResult` gained `cached` (namespaces served from the manifest) and `orphaned` (paths removed this run).
  - New `yamlParse` / `yamlStringify` re-exports — passthroughs to the bundled `yaml` package so consumers that already depend on `permissions-dsl` (for the fixture API) don't need a second YAML dependency.
  - VSCode extension: the Permissions Playground gains structured tuple builders (namespace/relation/subject dropdowns scoped to the schema), per-line tuple validation under the relationships textarea, **✨ Seed from schema** / **📂 Load fixture…** / **💾 Save fixture…** / **🔍 Discover checks** toolbar actions, a full-width result section, and a single combined Check button that always renders the trace. Pressing Enter in any builder field runs the check.

## 0.2.0

### Minor Changes

- 73b34ea: Switch tuple and DSL syntax to use `.` instead of `#` for the relation
  separator and `.*` instead of `:*` for wildcards. The structure is
  otherwise identical to Zanzibar/SpiceDB form.

  **Migration:** replace `#` with `.` and `:*` with `.*` everywhere they
  appear in `.perm` files, stored tuple strings, validation fixtures, and
  any code that calls `parseTuple` / `stringifyTuple` /
  `parseSubject` / `formatSubject` / `parseSubjectType`.

  Examples:

  | Old                               | New                          |
  | --------------------------------- | ---------------------------- |
  | `document#owner` (DSL userset)    | `document.owner`             |
  | `user:*` (DSL/tuple wildcard)     | `user.*`                     |
  | `doc:d1#owner@user:alice` (tuple) | `doc:d1.owner@user:alice`    |
  | `doc:d1#viewer@org:42#admin`      | `doc:d1.viewer@org:42.admin` |

  Object ids now also reject the structural characters `.`, `:`, `@`, `*`
  (via the Zod `IdSchema`) — they were never representable in canonical
  tuple strings, and excluding them removes a class of parse ambiguity.

- 73b34ea: Add a test/checker/playground for permissions, inspired by SpiceDB's
  validation-and-debugging tooling.

  **`@maroonedsoftware/permissions`** — three additive exports:
  - `explain(model, repo, object, relationOrPermission, subject)` —
    sibling of `check` that returns a hierarchical `CheckTrace` showing
    every evaluator branch (direct / computed / tupleToUserset / union /
    intersection / exclusion plus cycle / maxDepth / cached meta nodes).
    Designed for debugging, not the hot request path. Ships with a
    `formatTrace` renderer for plain-text output.
  - `InMemoryTupleRepository` — public `PermissionsTupleRepository`
    implementation backed by an array. Deduplicates writes by canonical
    tuple string. Suitable for fixtures, unit tests, and tooling.
  - `parseTuple` / `parseSubject` / `formatSubject` — string helpers
    inverse to `stringifyTuple`. Every tuple/subject round-trips through
    its canonical string form.

  **`@maroonedsoftware/permissions-dsl`** — fixture format + new `pdsl`
  subcommands:
  - SpiceDB-style `.perm.yaml` fixture format with `schemaFile` (or
    inline `schema:`), a `relationships:` heredoc, `assertions.assertTrue`
    / `assertions.assertFalse`, and SpiceDB-style `validation:` expected
    relations. Loaded via the new `loadFixture` / `runFixture` /
    `explainRelationship` programmatic API.
  - `pdsl validate <pattern>` — runs every assertion in one or more
    fixtures, prints a TAP-like report, exits non-zero on failure.
    Suitable for CI / test-suite use.
  - `pdsl check <fixture> <relationship>` — ad-hoc check against a
    loaded fixture.
  - `pdsl explain <fixture> <relationship>` (alias for `check --explain`)
    — prints the trace tree above the ALLOWED/DENIED verdict.
  - `pdsl compile` remains the default when no subcommand is given, so
    existing `pdsl --config foo.json` invocations keep working.

### Patch Changes

- Updated dependencies [73b34ea]
- Updated dependencies [73b34ea]
  - @maroonedsoftware/permissions@0.2.0

## 0.1.0

### Minor Changes

- 0143ea1: Add `@maroonedsoftware/permissions-dsl` — a surface-syntax DSL and `pdsl` CLI for authoring `@maroonedsoftware/permissions` namespaces in `.perm` files. Includes an Ohm-based parser, semantic validator, TypeScript codegen, and a multi-file compiler driven by `permissions.config.json`.
