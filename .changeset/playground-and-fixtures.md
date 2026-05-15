---
'@maroonedsoftware/permissions': minor
'@maroonedsoftware/permissions-dsl': minor
---

Add a test/checker/playground for permissions, inspired by SpiceDB's
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
