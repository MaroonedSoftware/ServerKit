# @maroonedsoftware/permissions-dsl

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
