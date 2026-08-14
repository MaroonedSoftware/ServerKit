# AGENTS.md — @maroonedsoftware/permissions

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

Zanzibar-style relationship-based access control: an `AuthorizationModel` of namespaces, relations,
and permissions; a store of relation tuples behind a `PermissionsTupleRepository`; and a `check()`
evaluator that answers "does this subject have this permission on this object?" by walking userset
rewrites. `explain()` answers the same question and returns the whole decision tree.

Reach for this when authorization depends on _relationships_ — ownership, org membership, folder
hierarchies, sharing. Do **not** reach for it for stateless allow/deny rules ("is this session
MFA-satisfied?", "is this account suspended?"); that is `@maroonedsoftware/policies`, which is far
cheaper and does no I/O. The two compose: a `Policy` can call `check()`.

Models are usually authored in the `.perm` surface syntax and compiled by
`@maroonedsoftware/permissions-dsl` into calls to the builders here.

## Install

```bash
pnpm add @maroonedsoftware/permissions
```

Runtime dependencies: `zod` (tuple schemas), `injectkit` (DI tokens). No internal dependencies.

## Position in the graph

- **Depends on:** nothing internal.
- **Depended on by:** `permissions-dsl`, `johnny5`.
- **Subpath exports:** none. The package has no `exports` map at all.

The evaluator has no storage of its own — you implement `PermissionsTupleRepository` over your
database. That is what keeps this package free of a `kysely` dependency.

## API surface

### Model DSL (`src/dsl.ts`)

| Export               | Kind      | Shape                                                                                                       | Notes                                                                                                                      |
| -------------------- | --------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `UsersetExpr`        | type      | Discriminated union on `kind`: `direct`, `computed`, `tupleToUserset`, `union`, `intersection`, `exclusion` | The rewrite language.                                                                                                      |
| `direct`             | builder   | `() => UsersetExpr`                                                                                         | Matches stored tuples on this relation.                                                                                    |
| `computed`           | builder   | `(relation: string) => UsersetExpr`                                                                         | Delegates to another relation/permission on the **same** object.                                                           |
| `tupleToUserset`     | builder   | `(tupleRelation: string, computedRelation: string) => UsersetExpr`                                          | Walk `tupleRelation` to a parent object, then evaluate `computedRelation` there.                                           |
| `union`              | builder   | `(...children: UsersetExpr[]) => UsersetExpr`                                                               | Any child allows.                                                                                                          |
| `intersection`       | builder   | `(...children: UsersetExpr[]) => UsersetExpr`                                                               | Every child must allow.                                                                                                    |
| `exclusion`          | builder   | `(base: UsersetExpr, subtract: UsersetExpr) => UsersetExpr`                                                 | `base && !subtract`.                                                                                                       |
| `SubjectType`        | type      | `string`                                                                                                    | `'user'`, `'user.*'` (wildcard), or `'org.member'` (userset).                                                              |
| `RelationDef`        | interface | `{ subjects: SubjectType[] }`                                                                               | Allowed direct-tuple subject types. **Enforced at write time, not at Check time.**                                         |
| `NamespaceDef<R, P>` | interface | `{ name: string; relations: Record<R, RelationDef>; permissions: Record<P, UsersetExpr> }`                  | —                                                                                                                          |
| `defineNamespace`    | function  | `<R, P>(name: string, def: { relations; permissions }) => NamespaceDef<R, P>`                               | Preserves literal types for relation and permission names.                                                                 |
| `AuthorizationModel` | class     | `new AuthorizationModel(namespaces: NamespaceDef[])`                                                        | **Validates on construction** and throws on a bad model. Methods: `namespaces()`, `get(name)`, `resolve(namespace, name)`. |

Names must match `/^[a-z][a-z0-9_]*$/` — lower snake_case. Duplicate namespaces, unknown subject
namespaces, unknown computed relations, and unwalkable `tupleToUserset` references all throw at
construction.

### Tuples (`src/tuple.ts`)

Each of these is a Zod schema **and** a type of the same name.

| Export           | Kind          | Shape                                                            | Notes                                                |
| ---------------- | ------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| `ObjectRef`      | schema + type | `{ namespace, id }`                                              | `id` must not contain `.`, `@`, `:`, or `*`.         |
| `SubjectRef`     | schema + type | Discriminated union on `kind`: `concrete`, `wildcard`, `userset` | `user:alice`, `user.*`, `org:42.admin`.              |
| `RelationTuple`  | schema + type | `{ object, relation, subject }`                                  | The unit of write and the input the evaluator walks. |
| `formatSubject`  | function      | `(s: SubjectRef) => string`                                      | Canonical string form.                               |
| `stringifyTuple` | function      | `(t: RelationTuple) => string`                                   | `ns:id.relation@subject`. Also the dedupe key.       |
| `parseSubject`   | function      | `(input: string) => SubjectRef`                                  | Inverse of `formatSubject`.                          |
| `parseTuple`     | function      | `(input: string) => RelationTuple`                               | Inverse of `stringifyTuple`.                         |

### Storage

| Export                       | Kind           | Shape                                                                                                                                                       | Notes                                                                                 |
| ---------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `PermissionsTupleRepository` | abstract class | `write(tuples, createdBy?)`, `delete(tuples)`, `listByObjectRelation(namespace, objectId, relation)`, `listObjectsRelatedBy(namespace, objectId, relation)` | An abstract class, not an interface, so it survives as an InjectKit token.            |
| `InMemoryTupleRepository`    | class          | `new InMemoryTupleRepository(seed: RelationTuple[] = [])`, plus `all()` and `clear()`                                                                       | For fixtures, `pdsl validate`, the VS Code playground, and tests. Not for production. |

`write` must be idempotent — duplicate `(object, relation, subject)` triples are no-ops.
`listObjectsRelatedBy` returns only **concrete** subjects; wildcard and userset subjects are not
meaningful as parent objects.

### Evaluation

| Export          | Kind      | Shape                                                                                                                                                             | Notes                                                                          |
| --------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `check`         | function  | `(model, repo, object: ObjectRef, relationOrPermission: string, subject: SubjectRef, sink?: CheckMetricsSink) => Promise<boolean>`                                | Short-circuits on the first allow. Throws on an unknown namespace or relation. |
| `explain`       | function  | `(model, repo, object, relationOrPermission, subject) => Promise<ExplainResult>`                                                                                  | Does **not** short-circuit — evaluates every branch so the trace is complete.  |
| `formatTrace`   | function  | `(trace: CheckTrace, indent = 0) => string`                                                                                                                       | Indented multi-line rendering with `✓`/`✗` markers.                            |
| `ExplainResult` | interface | `{ object, relation, subject, allowed, trace }`                                                                                                                   | —                                                                              |
| `CheckTrace`    | type      | Union of `DirectTrace`, `ComputedTrace`, `TupleToUsersetTrace`, `UnionTrace`, `IntersectionTrace`, `ExclusionTrace`, `CycleTrace`, `MaxDepthTrace`, `CachedTrace` | Each is exported individually too.                                             |

### Metrics

| Export               | Kind           | Shape                                                                         | Notes                                                           |
| -------------------- | -------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `CheckMetrics`       | interface      | `{ durationMs, tupleReads, parentLookups, cacheHits, maxDepth, hitMaxDepth }` | Mutated in place during a Check.                                |
| `CheckMetricsTags`   | interface      | `{ namespace, permission, allowed }`                                          | Low-cardinality dimensions.                                     |
| `newCheckMetrics`    | function       | `() => CheckMetrics`                                                          | Zeroed record. Sinks should not need it.                        |
| `CheckMetricsSink`   | abstract class | `record(metrics, tags): void`                                                 | Abstract class so it is a valid InjectKit token.                |
| `NoopMetricsSink`    | class          | Drops observations                                                            | —                                                               |
| `noopMetricsSink`    | constant       | Singleton `NoopMetricsSink`                                                   | `check`'s default. Reuse it rather than allocating.             |
| `LoggingMetricsSink` | class          | One single-line JSON `console.log` per Check                                  | `{ event: 'permissions.check', … }`. Log-based metrics stopgap. |

**Not part of the public API:** `__testing` (exported from `src/check.ts` to expose `MAX_DEPTH` to
tests). Do not import it.

## Canonical usage

```typescript
import {
  AuthorizationModel,
  defineNamespace,
  direct,
  computed,
  tupleToUserset,
  union,
  check,
  parseTuple,
  InMemoryTupleRepository,
} from '@maroonedsoftware/permissions';

const model = new AuthorizationModel([
  defineNamespace('org', {
    relations: { member: { subjects: ['user'] }, admin: { subjects: ['user'] } },
    permissions: { administer: computed('admin') },
  }),
  defineNamespace('document', {
    relations: { parent: { subjects: ['org'] }, owner: { subjects: ['user'] }, viewer: { subjects: ['user', 'user.*'] } },
    permissions: {
      view: union(direct(), computed('owner'), tupleToUserset('parent', 'member')),
      edit: union(computed('owner'), tupleToUserset('parent', 'administer')),
    },
  }),
]);

const repo = new InMemoryTupleRepository([parseTuple('document:readme.parent@org:acme'), parseTuple('org:acme.member@user:alice')]);

const allowed = await check(model, repo, { namespace: 'document', id: 'readme' }, 'view', { kind: 'concrete', namespace: 'user', id: 'alice' });
```

Debugging a decision:

```typescript
import { explain, formatTrace } from '@maroonedsoftware/permissions';

const result = await explain(model, repo, object, 'view', subject);
console.log(formatTrace(result.trace));
```

## Rules for generated code

- Build the `AuthorizationModel` **once**, at bootstrap, and register it as a singleton. Construction
  runs full validation; doing it per request pays that cost on every call and turns a startup
  failure into a request failure.
- Namespace, relation, and permission names are lower snake_case (`/^[a-z][a-z0-9_]*$/`). No
  hyphens, no camelCase, no dots.
- Use `defineNamespace` rather than a bare object literal so relation and permission names stay
  literal types.
- Never build tuples by string concatenation. Use `parseTuple` / `parseSubject` (validated) or the
  object form.
- Call `check()` on request paths. Call `explain()` only from CLIs, tooling, and tests — it
  deliberately evaluates every branch.
- Implement `PermissionsTupleRepository` by extending the abstract class, not by satisfying the
  shape structurally, or it will not resolve as an InjectKit token.
- Make `write` idempotent and `delete` tolerant of missing tuples. The evaluator assumes both.
- Pass a `CheckMetricsSink` in production. Without one, every Check is unobservable, and Check cost
  is the thing that goes wrong at scale.
- Prefer authoring models as `.perm` files compiled by `@maroonedsoftware/permissions-dsl` over
  hand-written builder calls once a model gets past a handful of namespaces.

## Gotchas

- **`RelationDef.subjects` is not enforced at Check time.** It constrains what may be _written_.
  If your repository does not validate against the model on write, a tuple with a disallowed
  subject type will still grant access. The evaluator trusts the store.
- **Recursion is capped at `MAX_DEPTH = 32`.** Exceeding it returns `false` and sets
  `metrics.hitMaxDepth`. That is a silent deny: a deep hierarchy looks like "no permission", not
  like an error. Watch `hitMaxDepth`.
- **The memo is per call, not per request.** Every `check()` allocates a fresh memo and cycle guard.
  Two `check()` calls in one request share nothing. Batch related questions into one call where
  you can, or add a caching layer above.
- **`explain()` and `check()` can do very different amounts of work.** `explain()` does not
  short-circuit unions or intersections. The top-level `allowed` matches, but the cost does not.
- **Cycles return `false`, not an error.** The visiting set detects them and emits a `CycleTrace`
  in `explain()`; `check()` just denies.
- **`ObjectRef.id` cannot contain `.`, `@`, `:`, or `*`.** Those are the delimiters in the
  canonical tuple string. An id sourced from user input must be validated or encoded.
- **`InMemoryTupleRepository` ignores `createdBy`.** It is accepted for interface compatibility
  and dropped.
- **`LoggingMetricsSink` writes to `console.log` directly**, not through `@maroonedsoftware/logger`
  — this package has no logger dependency by design. In an app with a structured logger, write
  your own sink instead.

## Working inside this package

```
src/
  dsl.ts                    UsersetExpr builders, NamespaceDef, AuthorizationModel + validation
  tuple.ts                  Zod schemas and parse/format helpers for objects, subjects, tuples
  tuples.repository.ts      PermissionsTupleRepository abstract class
  in.memory.repository.ts   InMemoryTupleRepository
  check.ts                  The Check evaluator, MAX_DEPTH, __testing hook
  explain.ts                Trace types, explain(), formatTrace()
  check.metrics.ts          CheckMetrics, tags, sink token, noop sink
  check.metrics.logging.ts  LoggingMetricsSink
  index.ts                  Barrel
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **No internal dependencies.** In particular, no `logger` and no `kysely` — storage and logging
  are both plugged in by the consumer.
- `check.ts` and `explain.ts` implement the same semantics twice, on purpose (one short-circuits,
  one does not). A change to evaluation rules must land in both, and `tests/explain.test.ts` should
  assert they agree on `allowed`.
- `AuthorizationModel` validation happens in the constructor. Keep it there — the guarantee is
  that a bad model fails at startup, never at Check time.
- `PermissionsTupleRepository` and `CheckMetricsSink` must stay abstract classes, not interfaces,
  or they stop working as InjectKit tokens.
- The tuple string grammar in `tuple.ts` is shared with `permissions-dsl` fixtures and the VS Code
  extension. Changing it breaks both.

User-visible changes need a changeset in `.changeset/`.
