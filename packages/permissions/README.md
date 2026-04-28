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
- **Pluggable metrics** — `CheckMetricsSink` lets you forward per-Check observations to whatever telemetry backend is in use; ships with a `LoggingMetricsSink` for log-based metrics

## Concepts

The library follows the Zanzibar paper's vocabulary:

- A **namespace** is the type of an object (`doc`, `folder`, `org`, …).
- A **relation** is an edge stored as a tuple — `<object>#<relation>@<subject>`.
- A **permission** is a userset rewrite expression evaluated over relations.
- A **subject** is either a concrete object (`user:alice`), a wildcard (`user:*`), or a userset (`org:42#admin`).

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
    viewer: { subjects: ['user', 'user:*', 'org#admin'] },
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
| `user:*`              | Wildcard — every subject of that namespace allowed     |
| `org#admin`           | Userset — every subject satisfying `admin` on any `org`|

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
