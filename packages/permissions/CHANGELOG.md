# @maroonedsoftware/permissions

## 0.4.0

### Minor Changes

- f0ed3e5: New `lookupObjects(model, repo, namespace, permission, subject, options?)` lists every object a concrete subject holds a permission on. It expands groups, `computed` chains, and recursive `tupleToUserset` hierarchies by walking the model backwards from the subject's tuples, then confirms each candidate with `checkDetailed` so that exclusions and intersections are honoured. An every-object `*` grant is reported as `everyObject: true` rather than enumerated. It requires a repository that implements `listObjects`.
- 3ff953b: `check`, `checkDetailed`, `explain`, and `lookupObjects` take an optional `CheckOptions` bag as their last argument: `{ sink?, maxDepth? }`. `maxDepth` replaces the fixed recursion cap of 32 (still the default), so a model with long chains such as a reporting line can raise it; a value that is not a positive integer throws `RangeError`. `sink` moves the metrics sink into the bag. Passing a bare `CheckMetricsSink` as the 6th argument of `check` or `checkDetailed`, the 0.3.0 form, still works but is deprecated.
- 85a23d9: Every-object grants. A relation declared with `objectWildcard: true` accepts tuples whose object id is `*` (`doc:*.platform_admin@user:alice`), which grant the relation on every object of the namespace. Use them for platform-wide roles. `check` and `explain` read the `*` row only for opted-in relations. A `*` parent edge makes that parent apply to every object. `ModelValidatingTupleRepository` rejects `*` tuples on other relations with the new `object_wildcard_not_allowed` code. New exports: `OBJECT_WILDCARD`, `TupleObjectRef`, and `AuthorizationModel.allowsObjectWildcard`. `RelationTuple.object` is now a `TupleObjectRef`, which has the same shape as `ObjectRef`.
- dc79b53: New `@maroonedsoftware/permissions/conformance` subpath with `verifyTupleRepository`, a test-runner-agnostic check of a `PermissionsTupleRepository` against the contract the evaluator relies on. It checks idempotent writes, that deleted tuples vanish from every read (with or without `deletedBy`), that a re-grant after a revoke is visible, that parent edges are concrete only, that `*` object ids come back literally, and that listings match the exact subject. The `delete` contract now recommends keeping revocation history by moving the row to a history table in the same transaction, rather than flagging it in the live table. The package gains an `exports` map; the root import is unchanged.
- c3237ce: `PermissionsTupleRepository.delete` takes an optional `deletedBy`, the counterpart of `write`'s `createdBy`, and its contract now allows a soft delete. A backend can keep the revoked row and who revoked it, provided every read leaves the row out. `ModelValidatingTupleRepository` forwards it.

## 0.3.0

### Minor Changes

- 4ad43c5: Add reverse listings to the tuple repository contract: `listSubjects(namespace, objectId, relation)`
  answers "who is on this object?" and `listObjects(namespace, relation, subject)` answers "what is
  this subject on?". Neither existed, so there was no way to enumerate a relation's members without
  reaching past the repository.

  Both are optional on `PermissionsTupleRepository` so existing implementations keep compiling; check
  for the method before calling it. `InMemoryTupleRepository` implements both. `listObjects` is a
  direct-tuple index, not a Check, so a subject with access only through a `tupleToUserset` parent
  does not appear in its results.

- 4ad43c5: Enforce `RelationDef.subjects` on write. The field was documented as a write-time contract, but
  nothing in the package enforced it and no shipped repository validated on the way in, so a relation
  deliberately declared without `user.*` was still world-grantable by writing that tuple directly.

  Adds `AuthorizationModel.isSubjectAllowed` and `assertTuplesAllowed`, plus a
  `ModelValidatingTupleRepository` decorator that wraps any repository and validates before writing.
  Reads pass straight through, and deletes are not validated.

- 4ad43c5: Raise a typed `PermissionsError` for an unknown namespace or relation, and let callers tell a
  denial from a depth-capped answer.

  `AuthorizationModel.resolve` threw a plain `Error`, so a misspelt permission name at a call site
  was indistinguishable from any other failure. It now throws `PermissionsError` carrying a `code`
  of `'unknown_namespace'`, `'unknown_relation'`, or `'subject_not_allowed'`, with an
  `IsPermissionsError` guard.

  Adds `checkDetailed`, which returns `{ allowed, maxDepthExceeded, metrics }`. Exceeding the depth
  cap made `check` return `false`, indistinguishable from a real denial; `maxDepthExceeded` separates
  "could not determine" from "denied". `check` is unchanged.

## 0.2.9

### Patch Changes

- 7587006: Update runtime dependency ranges across the workspace (injectkit ^1.7.1, zod ^4.5.4, deepmerge-ts ^8, raw-body ^4, qs ^6.16, kysely ^0.29.5, pg ^8.23, @modelcontextprotocol/sdk ^1.30, @fastify/busboy ^3.2.2, and related minors).

## 0.2.8

### Patch Changes

- be035ce: Ship the MIT LICENSE file in the published package tarball, and link to it from the README.

## 0.2.7

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

## 0.2.6

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

## 0.2.5

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

## 0.2.4

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

## 0.2.3

### Patch Changes

- dfe5304: Declare `engines.node >= 22` in the package manifest to match the supported runtime.

## 0.2.2

### Patch Changes

- b759188: Bump shared runtime dependencies: `injectkit` to `^1.6.0` across packages, plus package-specific bumps to `zxcvbn-ts` (authentication), `@slack/web-api` (slack), `mime-types` (storage), and `prettier` (permissions-dsl).

## 0.2.1

### Patch Changes

- a167ee3: Bump runtime dependencies (notably `injectkit` to 1.4.1) and relax the pgboss job registration type guard so it accepts the updated `Identifier` shape.

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

## 0.1.1

### Patch Changes

- db220a1: chore: bump kysely, zod patch versions
- 9e2c2de: chore: update package versions for dependencies and devDependencies

## 0.1.0

### Minor Changes

- 433097f: Add the `@maroonedsoftware/permissions` package — a Zanzibar-style relationship-based access control library with an authorization model DSL (`direct`, `computed`, `tupleToUserset`, `union`, `intersection`, `exclusion`), a validated `AuthorizationModel`, an abstract `PermissionsTupleRepository` for pluggable storage, and a recursive Check evaluator with per-request memo, cycle guard, and a pluggable `CheckMetricsSink` (with a built-in `LoggingMetricsSink`).
