# @maroonedsoftware/permissions

A Zanzibar-style relationship-based access control library for ServerKit. Provides an authorization model DSL, a relation-tuple repository contract, and a Check evaluator with per-request metrics.

## Installation

```bash
pnpm add @maroonedsoftware/permissions
```

## Features

- **Authorization model DSL** — declare namespaces, relations, and permissions as userset rewrite expressions (`direct`, `computed`, `tupleToUserset`, `union`, `intersection`, `exclusion`)
- **Validated model** — `AuthorizationModel` checks name shapes and cross-references at construction so a bad model fails at startup, not at Check time
- **Relation tuples** — Zod-validated `RelationTuple` shape with concrete, wildcard, and userset subjects
- **Pluggable storage** — implement the abstract `PermissionsTupleRepository` against your database of choice (typically Kysely/Postgres)
- **Check evaluator** — recursive evaluator with per-request memo, cycle guard, and a configurable max-depth bound
- **Trace explainer** — `explain` returns a hierarchical `CheckTrace` showing exactly which evaluator branches fired; drives `pdsl explain` and the VSCode playground
- **In-memory repository** — `InMemoryTupleRepository` for fixtures, tests, and ad-hoc tooling without a database
- **Pluggable metrics** — `CheckMetricsSink` lets you forward per-Check observations to whatever telemetry backend is in use; ships with a `LoggingMetricsSink` for log-based metrics

## Concepts

The library follows the Zanzibar paper's vocabulary, with one notational
swap from the original paper — see [Tuple syntax](#tuple-syntax) below:

- A **namespace** is the type of an object (`doc`, `folder`, `org`, …).
- A **relation** is an edge stored as a tuple — `<object>.<relation>@<subject>`.
- A **permission** is a userset rewrite expression evaluated over relations.
- A **subject** is either a concrete object (`user:alice`), a wildcard (`user.*`), or a userset (`org:42.admin`).

## Tuple syntax

Relationships are stored and serialised as strings with this grammar:

```
tuple   = object "." relation "@" subject
object  = type ":" id
subject = type ":" id            // concrete subject
        | type ".*"              // wildcard subject (everyone of that type)
        | object "." relation    // userset subject (a group)
```

Examples:

| Form     | Example                                | Reading                                                       |
| -------- | -------------------------------------- | ------------------------------------------------------------- |
| concrete | `doc:readme.viewer@user:alice`         | alice can `viewer` the `readme` doc                           |
| wildcard | `doc:readme.viewer@user.*`             | every user can `viewer` the `readme` doc (public grant)       |
| userset  | `doc:readme.viewer@org:42.admin`       | every admin of org 42 can `viewer` the `readme` doc           |

The two separators do conceptually different jobs:

- `:` is for **runtime identity** — binds a concrete id to a type
  (`user:alice`, `doc:readme`). Anything between `:` and the next `.`/`@`
  is the id.
- `.` is for **schema-level scoping** — names a relation or wildcard *on*
  a type (`user.*`, `org:42.admin`, `doc:readme.viewer`).

Because the two separators are distinct, object ids may contain dots
safely (the `:` unambiguously marks where the id begins). Coming from
the Zanzibar paper or SpiceDB? Translate `#` → `.` and `:*` → `.*`; the
structure is otherwise identical.

`parseTuple` and `stringifyTuple` are inverses — every tuple round-trips
through its canonical string form unchanged. Same goes for `parseSubject`
/ `formatSubject`.

### `user:alice` vs `user.*`

The two forms are not interchangeable, and a `relation` may allow either
or both via its subject-type list:

- `user:alice` is a **per-user grant**. Storing
  `doc:readme.viewer@user:alice` grants `viewer` to that specific user.
- `user.*` is a **public grant**. Storing `doc:readme.viewer@user.*`
  grants `viewer` to **every** user at once.

Omitting `user.*` from a relation's subject types makes it impossible to
write a public tuple for that relation — useful when you want to be sure
nothing on a resource can be made world-readable.

## Usage

### Define an authorization model

```ts
import {
  AuthorizationModel,
  computed,
  defineNamespace,
  direct,
  exclusion,
  tupleToUserset,
  union,
} from '@maroonedsoftware/permissions';

const user = defineNamespace('user', { relations: {}, permissions: {} });

const folder = defineNamespace('folder', {
  relations: { viewer: { subjects: ['user'] } },
  permissions: {},
});

const doc = defineNamespace('doc', {
  relations: {
    parent: { subjects: ['folder'] },
    viewer: { subjects: ['user', 'user.*', 'org.admin'] },
    owner: { subjects: ['user'] },
    banned: { subjects: ['user'] },
  },
  permissions: {
    // view = direct viewers ∪ owners ∪ viewers on the parent folder
    view: union(direct(), computed('owner'), tupleToUserset('parent', 'viewer')),
    // editable = view, but not anyone in `banned`
    editable: exclusion(computed('view'), computed('banned')),
  },
});

const model = new AuthorizationModel([user, folder, doc]);
```

### Implement the tuple repository

`PermissionsTupleRepository` is an abstract class — implement it against your storage backend. A typical implementation uses a request-scoped Kysely binding against a `relation_tuples` table.

```ts
import { PermissionsTupleRepository, RelationTuple } from '@maroonedsoftware/permissions';

class KyselyTupleRepository extends PermissionsTupleRepository {
  constructor(private readonly db: Kysely<DB>) {
    super();
  }

  async write(tuples: RelationTuple[], createdBy?: string): Promise<void> {
    // upsert each tuple; treat duplicates as no-ops
  }

  async delete(tuples: RelationTuple[]): Promise<void> {
    // delete by exact (object, relation, subject) shape
  }

  async listByObjectRelation(namespace: string, objectId: string, relation: string) {
    // SELECT * FROM relation_tuples WHERE ...
  }

  async listObjectsRelatedBy(namespace: string, objectId: string, relation: string) {
    // SELECT subject_namespace, subject_id WHERE ... AND subject_kind = 'concrete'
  }
}
```

### Run a Check

```ts
import { check } from '@maroonedsoftware/permissions';

const allowed = await check(
  model,
  repo,
  { namespace: 'doc', id: 'doc-42' },
  'view',
  { kind: 'concrete', namespace: 'user', id: 'alice' },
);
```

`check` walks the userset rewrite for `view`, short-circuiting on the first allow, and returns `true`/`false`. Each call has its own per-request memo and cycle guard; recursion is capped at depth 32.

### Metrics

Pass a `CheckMetricsSink` to forward observations to telemetry. The package ships with a noop default and a logging sink:

```ts
import { check, LoggingMetricsSink } from '@maroonedsoftware/permissions';

const sink = new LoggingMetricsSink();

await check(model, repo, object, 'view', subject, sink);
// → console.log({ event: 'permissions.check', namespace, permission, allowed,
//                  duration_ms, tuple_reads, parent_lookups, cache_hits,
//                  max_depth, hit_max_depth })
```

Implement your own sink by extending `CheckMetricsSink`:

```ts
import { CheckMetricsSink, CheckMetrics, CheckMetricsTags } from '@maroonedsoftware/permissions';

class DataDogMetricsSink extends CheckMetricsSink {
  record(metrics: CheckMetrics, tags: CheckMetricsTags): void {
    // forward to your telemetry backend
  }
}
```

## API Reference

### Userset expressions

| Constructor                              | Meaning                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| `direct()`                               | Resolves through directly stored tuples on the relation being checked  |
| `computed(relation)`                     | Delegates to another relation/permission on the same object            |
| `tupleToUserset(tupleRel, computedRel)`  | Walks `tupleRel` to parent objects and evaluates `computedRel` on each |
| `union(...children)`                     | Logical OR — first allow wins                                          |
| `intersection(...children)`              | Logical AND — first deny wins                                          |
| `exclusion(base, subtract)`              | Subjects allowed by `base` but not by `subtract`                       |

### Subject types

Allowed subjects on a relation are declared as strings:

| String form           | Meaning                                                |
| --------------------- | ------------------------------------------------------ |
| `user`                | Any concrete subject from the `user` namespace         |
| `user.*`              | Wildcard — every subject of that namespace allowed     |
| `org.admin`           | Userset — every subject satisfying `admin` on any `org`|

### `AuthorizationModel`

| Method               | Description                                                          |
| -------------------- | -------------------------------------------------------------------- |
| `new (namespaces)`   | Validates names and cross-references; throws on any inconsistency    |
| `namespaces()`       | All registered namespaces, in insertion order                        |
| `get(name)`          | Look up a namespace by name; `undefined` for unknown                 |
| `resolve(ns, name)`  | Returns the userset expression to evaluate (relations are `direct`)  |

### `PermissionsTupleRepository`

| Method                                              | Description                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------ |
| `write(tuples, createdBy?)`                         | Insert idempotently                                                      |
| `delete(tuples)`                                    | Remove by exact shape; missing rows are a no-op                          |
| `listByObjectRelation(namespace, objectId, rel)`    | All tuples for a `(object, relation)` pair — feeds the `direct` step     |
| `listObjectsRelatedBy(namespace, objectId, rel)`    | Concrete-subject parents for a `tupleToUserset` walk                     |

### `check(model, repo, object, relationOrPermission, subject, sink?)`

Returns `Promise<boolean>`. Throws if the namespace or relation/permission is unknown.

### `explain(model, repo, object, relationOrPermission, subject)`

Sibling of `check` that returns an `ExplainResult` containing both the
boolean outcome and a hierarchical `CheckTrace`. Unlike `check`, the
explainer does not short-circuit child evaluation — every branch of a
union/intersection runs so the resulting trace is fully debuggable.
Use for `--explain` CLI output, the VSCode playground, or any tooling
that needs to surface *why* a check decision came out the way it did.
Not for the hot request path.

```ts
import { explain, formatTrace } from '@maroonedsoftware/permissions';

const result = await explain(model, repo, object, 'view', subject);
console.log(result.allowed ? 'ALLOWED' : 'DENIED');
console.log(formatTrace(result.trace));
```

`CheckTrace` is a discriminated union — one variant per evaluator step
(`direct`, `computed`, `tupleToUserset`, `union`, `intersection`,
`exclusion`) plus three meta nodes (`cycle`, `maxDepth`, `cached`).
Every node carries an `allowed` flag.

### `InMemoryTupleRepository`

Public `PermissionsTupleRepository` implementation backed by a plain
array. Deduplicates writes by canonical tuple string. Use for fixtures,
unit tests, and tooling (the `pdsl validate` runner and VSCode
playground both build on it).

```ts
import { InMemoryTupleRepository, parseTuple } from '@maroonedsoftware/permissions';

const repo = new InMemoryTupleRepository([
  parseTuple('doc:readme.owner@user:alice'),
  parseTuple('folder:eng.viewer@user:bob'),
]);
```

### Tuple string helpers

`stringifyTuple` / `parseTuple` and `formatSubject` / `parseSubject` are
inverses — every tuple or subject round-trips through its canonical
string form. Useful for logs, fixtures, and serialising over the wire.

### `CheckMetrics`

| Field            | Description                                           |
| ---------------- | ----------------------------------------------------- |
| `durationMs`     | Total wall-clock time of the Check                    |
| `tupleReads`     | Count of `repo.listByObjectRelation` calls            |
| `parentLookups`  | Count of `repo.listObjectsRelatedBy` calls            |
| `cacheHits`      | Per-request memo hits                                 |
| `maxDepth`       | Greatest recursion depth reached                      |
| `hitMaxDepth`    | True if the evaluator hit the max-depth guard (32)    |

## License

MIT
