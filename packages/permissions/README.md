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
- **Every-object grants** — a relation declared with `objectWildcard: true` accepts `doc:*.admin@user:alice`, which grants the relation on every `doc` at once, for platform-wide roles
- **Pluggable storage** — implement the abstract `PermissionsTupleRepository` against your database of choice (typically Kysely/Postgres)
- **Check evaluator** — recursive evaluator with per-request memo, cycle guard, and a configurable max-depth bound; `checkDetailed` also reports whether the depth cap was hit, so a denial is distinguishable from an answer the evaluator could not reach
- **Write-time subject validation** — `ModelValidatingTupleRepository` wraps any repository and enforces each relation's declared `subjects`, so a relation without `user.*` cannot be made world-grantable by writing the tuple directly
- **Typed errors** — an unknown namespace or relation raises a `PermissionsError` with a `code`, never a silent denial
- **Reverse listings** — optional `listSubjects` and `listObjects` on the repository contract answer "who is on this object?" and "what is this subject on?"
- **Effective object lookup** — `lookupObjects` lists every object a subject holds a permission on, expanding groups, `computed` chains, and `tupleToUserset` hierarchies, then confirms each with a Check
- **Trace explainer** — `explain` returns a hierarchical `CheckTrace` showing exactly which evaluator branches fired; drives `pdsl explain` and the VSCode playground
- **Repository conformance check** — `verifyTupleRepository` from `@maroonedsoftware/permissions/conformance` runs your repository against the contract the evaluator relies on, including that a revoked tuple is gone from every read
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
        | type ":*"              // every object of that type (opt-in per relation)
subject = type ":" id            // concrete subject
        | type ".*"              // wildcard subject (everyone of that type)
        | object "." relation    // userset subject (a group)
```

Examples:

| Form     | Example                          | Reading                                                 |
| -------- | -------------------------------- | ------------------------------------------------------- |
| concrete | `doc:readme.viewer@user:alice`   | alice can `viewer` the `readme` doc                     |
| wildcard | `doc:readme.viewer@user.*`       | every user can `viewer` the `readme` doc (public grant) |
| userset  | `doc:readme.viewer@org:42.admin` | every admin of org 42 can `viewer` the `readme` doc     |
| object * | `doc:*.admin@user:alice`         | alice can `admin` every doc                             |

The two separators do conceptually different jobs:

- `:` is for **runtime identity** — binds a concrete id to a type
  (`user:alice`, `doc:readme`). Anything between `:` and the next `.`/`@`
  is the id.
- `.` is for **schema-level scoping** — names a relation or wildcard _on_
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

### `doc:*` (every object)

`user.*` widens the **subject** side. `doc:*` widens the **object** side:
`doc:*.admin@user:alice` gives alice `admin` on every `doc`, present and
future, with one row. It is how platform roles fit the model without a
tuple per object.

A relation has to opt in, because Check then reads one extra row for it:

```ts
relations: {
  platform_admin: { subjects: ['user'], objectWildcard: true },
}
```

`ModelValidatingTupleRepository` rejects a `*` tuple on any other relation
with `object_wildcard_not_allowed`, and Check never reads one there. A `*`
row on a `tupleToUserset` relation works too: `doc:*.parent@folder:root`
makes `root` a parent of every doc. `*` is only valid in a stored tuple; a
Check is always about one concrete object.

## Usage

### Define an authorization model

```ts
import { AuthorizationModel, computed, defineNamespace, direct, exclusion, tupleToUserset, union } from '@maroonedsoftware/permissions';

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

  async delete(tuples: RelationTuple[], deletedBy?: string): Promise<void> {
    // delete by exact (object, relation, subject) shape; to keep history, move the row (see below)
  }

  async listByObjectRelation(namespace: string, objectId: string, relation: string) {
    // SELECT * FROM relation_tuples WHERE ...
  }

  async listObjectsRelatedBy(namespace: string, objectId: string, relation: string) {
    // SELECT subject_namespace, subject_id WHERE ... AND subject_kind = 'concrete'
  }
}
```

### Keep revocation history without leaking revoked grants

Every read Check makes trusts the store. A soft delete that flags a row
`revoked_at` but misses the filter in one read keeps that grant alive. So
instead of flagging, **move** the row on revoke: delete it from the live table
and record it in a history table in the same transaction.

```sql
WITH revoked AS (
  DELETE FROM relation_tuples
  WHERE object_namespace = $1 AND object_id = $2 AND relation = $3
    AND subject_kind = $4 AND subject_namespace = $5 AND subject_id = $6 AND subject_relation IS NOT DISTINCT FROM $7
  RETURNING *
)
INSERT INTO relation_tuple_revocations
SELECT revoked.*, $8 AS deleted_by, now() AS deleted_at FROM revoked;
```

`relation_tuples` then only ever holds live grants, the reads need no filter,
and `relation_tuple_revocations` keeps who granted, who revoked, and when. A
re-grant after a revoke is an ordinary insert.

### Verify your repository

`verifyTupleRepository` runs the repository contract (idempotent writes,
deletes that vanish from every read, re-grants after a revoke, concrete-only
parent edges, literal `*` object ids, exact-subject listings) and returns a
report. It does not depend on a test runner:

```ts
import { verifyTupleRepository } from '@maroonedsoftware/permissions/conformance';

it('conforms to the tuple repository contract', async () => {
  const report = await verifyTupleRepository(() => new KyselyTupleRepository(testDb), {
    teardown: () => testDb.deleteFrom('relation_tuples').execute(),
  });
  expect(report.failures).toEqual([]);
});
```

Each rule gets a fresh repository from the factory and ids suffixed per rule,
so a shared store gives independent results. Rules for the optional
`listSubjects` and `listObjects` are reported under `skipped` when the
repository lacks them. If your backend rejects unknown namespaces, wrap it with
`ModelValidatingTupleRepository` and the exported `conformanceModel`. Run it
against a disposable database: it writes and deletes rows.

### Run a Check

```ts
import { check } from '@maroonedsoftware/permissions';

const allowed = await check(model, repo, { namespace: 'doc', id: 'doc-42' }, 'view', { kind: 'concrete', namespace: 'user', id: 'alice' });
```

`check` walks the userset rewrite for `view`, short-circuiting on the first allow, and returns `true`/`false`. Each call has its own per-request memo and cycle guard; recursion is capped at depth 32 by default. Raise the cap for models with long chains (a reporting line walked through `manager->...`):

```ts
await check(model, repo, object, 'view', subject, { maxDepth: 128 });
```

### Metrics

Pass a `CheckMetricsSink` to forward observations to telemetry. The package ships with a noop default and a logging sink:

```ts
import { check, LoggingMetricsSink } from '@maroonedsoftware/permissions';

const sink = new LoggingMetricsSink();

await check(model, repo, object, 'view', subject, { sink });
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

| Constructor                             | Meaning                                                                |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `direct()`                              | Resolves through directly stored tuples on the relation being checked  |
| `computed(relation)`                    | Delegates to another relation/permission on the same object            |
| `tupleToUserset(tupleRel, computedRel)` | Walks `tupleRel` to parent objects and evaluates `computedRel` on each |
| `union(...children)`                    | Logical OR — first allow wins                                          |
| `intersection(...children)`             | Logical AND — first deny wins                                          |
| `exclusion(base, subtract)`             | Subjects allowed by `base` but not by `subtract`                       |

### Subject types

Allowed subjects on a relation are declared as strings:

| String form | Meaning                                                 |
| ----------- | ------------------------------------------------------- |
| `user`      | Any concrete subject from the `user` namespace          |
| `user.*`    | Wildcard — every subject of that namespace allowed      |
| `org.admin` | Userset — every subject satisfying `admin` on any `org` |

A `RelationDef` is `{ subjects, objectWildcard? }`. `objectWildcard: true`
lets the relation hold every-object tuples (`doc:*.admin@user:alice`).

### `AuthorizationModel`

| Method                          | Description                                                         |
| ------------------------------- | ------------------------------------------------------------------- |
| `new (namespaces)`              | Validates names and cross-references; throws on any inconsistency   |
| `namespaces()`                  | All registered namespaces, in insertion order                       |
| `get(name)`                     | Look up a namespace by name; `undefined` for unknown                |
| `resolve(ns, name)`             | Returns the userset expression to evaluate (relations are `direct`) |
| `allowsObjectWildcard(ns, rel)` | Whether the relation declared `objectWildcard: true`                |

### `PermissionsTupleRepository`

| Method                                           | Description                                                          |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| `write(tuples, createdBy?)`                      | Insert idempotently                                                  |
| `delete(tuples, deletedBy?)`                     | Remove by exact shape; missing rows are a no-op. Gone from all reads |
| `listByObjectRelation(namespace, objectId, rel)` | All tuples for a `(object, relation)` pair — feeds the `direct` step |
| `listObjectsRelatedBy(namespace, objectId, rel)` | Concrete-subject parents for a `tupleToUserset` walk                 |

### `check(model, repo, object, relationOrPermission, subject, options?)`

Returns `Promise<boolean>`. Throws if the namespace or relation/permission is unknown. `options` is `{ sink?, maxDepth? }`: `sink` receives one `CheckMetrics` observation per call, and `maxDepth` sets the recursion cap (default 32; a non-positive or fractional value throws `RangeError`). `checkDetailed` takes the same arguments.

Passing a bare `CheckMetricsSink` as the 6th argument, the 0.3.0 form, still works but is deprecated; wrap it as `{ sink }`.

### `lookupObjects(model, repo, namespace, permission, subject, options?)`

"Which docs can alice view?" Returns
`{ objects, everyObject, maxDepthExceeded, candidates }`. Needs a repository
that implements `listObjects`, and a concrete subject.

It walks the model backwards from the tuples that name the subject (group to
members, parent folder to children, relation to the permissions built on it),
then confirms every candidate with `checkDetailed`. Exclusions and
intersections therefore come out exactly as `check` would answer them.
`everyObject: true` means a `doc:*` tuple reached the permission, so the
subject may hold it on objects no tuple names; `check` a specific object to be
sure.

```ts
const { objects } = await lookupObjects(model, repo, 'doc', 'view', { kind: 'concrete', namespace: 'user', id: 'alice' });
```

It costs one `listObjects` call per reached `(object, relation)` pair plus one
Check per candidate, so use it for listing screens and jobs rather than per
request.

### `explain(model, repo, object, relationOrPermission, subject, options?)`

Sibling of `check` that returns an `ExplainResult` containing both the
boolean outcome and a hierarchical `CheckTrace`. Unlike `check`, the
explainer does not short-circuit child evaluation — every branch of a
union/intersection runs so the resulting trace is fully debuggable.
Use for `--explain` CLI output, the VSCode playground, or any tooling
that needs to surface _why_ a check decision came out the way it did.
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

const repo = new InMemoryTupleRepository([parseTuple('doc:readme.owner@user:alice'), parseTuple('folder:eng.viewer@user:bob')]);
```

### Tuple string helpers

`stringifyTuple` / `parseTuple` and `formatSubject` / `parseSubject` are
inverses — every tuple or subject round-trips through its canonical
string form. Useful for logs, fixtures, and serialising over the wire.

### `CheckMetrics`

| Field           | Description                                   |
| --------------- | --------------------------------------------- |
| `durationMs`    | Total wall-clock time of the Check            |
| `tupleReads`    | Count of `repo.listByObjectRelation` calls    |
| `parentLookups` | Count of `repo.listObjectsRelatedBy` calls    |
| `cacheHits`     | Per-request memo hits                         |
| `maxDepth`      | Greatest recursion depth reached              |
| `hitMaxDepth`   | True if the evaluator hit the max-depth guard |

## Doctor checks

`@maroonedsoftware/johnny5/permissions` ships ready-made checks for the
`my-cli doctor` runner — they keep `.perm` authoring artifacts honest and
catch model errors before they reach a runtime `check`:

```ts
import { permissionsModelLoads } from '@maroonedsoftware/johnny5/permissions';
import { kyselyTableExists } from '@maroonedsoftware/johnny5/kysely';

const checks = [
  permissionsModelLoads({ loadModel: async () => (await import('./permissions/generated/index.js')).model }),
  kyselyTableExists({ db, table: 'relation_tuples' }),
];
```

See the [`@maroonedsoftware/johnny5` README](../johnny5/README.md#built-in-check-libraries)
for the full list — it also covers `permissionsSchemaCompiled` (`.perm` ↔
generated TS drift) and `permissionsFixturesPass` (every `*.perm.yaml`
asserts as expected).

## License

MIT — see [LICENSE](./LICENSE).
