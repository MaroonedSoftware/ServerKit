# @maroonedsoftware/permissions-dsl

Surface DSL + compiler (`pdsl`) for `@maroonedsoftware/permissions`. Parses `.perm`
files into TypeScript that calls the existing `defineNamespace`/`union`/
`intersection`/`exclusion`/`computed`/`tupleToUserset` builders.

## Surface syntax

```
namespace document {
  relation parent: folder
  relation owner:  user
  relation editor: user, document.owner
  relation viewer: user, user.*, document.editor
  relation banned: user

  permission edit   = owner | editor
  permission view   = edit | viewer | parent->viewer
  permission delete = edit - banned
}
```

Identifiers are lowercase `[a-z][a-z0-9_]*`. `//` line comments. Subject
lists use commas — a list of *allowed* subject types, not a union.

## Subject types

Each `relation` declares which kinds of subjects may receive it. Three forms:

- **Bare type** — `user`. Permits per-subject grants. A tuple like
  `document:readme.viewer@user:alice` grants `viewer` on that document to
  the specific user `alice`.
- **Wildcard** — `user.*`. Permits the public "all of them" grant. A single
  tuple `document:readme.viewer@user.*` grants `viewer` to **every** user at
  once. Omit this form to prevent world-readable tuples for the relation.
- **Userset** — `document.editor`. Permits a *group* defined by another
  relation. A tuple like `document:readme.viewer@document:other.editor`
  grants `viewer` on `readme` to everyone who is `editor` on `other`. Common
  for layering: `viewer ← editor ← owner`.

Listing `user` and `user.*` in the same subject list is normal — they
authorize two different *kinds* of tuples (per-user and public).

## Permission expressions

Permissions are computed sets, defined with set-algebra over relation
references and parent walks:

| Symbol | Meaning        | Arity        | Example                |
| ------ | -------------- | ------------ | ---------------------- |
| `\|`   | union          | n-ary        | `owner \| editor`      |
| `&`    | intersection   | n-ary        | `viewer & paid`        |
| `-`    | exclusion      | binary, left | `edit - banned`        |
| `->`   | tupleToUserset | binary       | `parent->viewer`       |
| `( )`  | grouping       | —            | `(a \| b) & c`         |

Precedence (low → high): `-`, `\|`, `&`, atom (`(...)` / `a->b` / `name`).

`parent->viewer` walks the `parent` relation to the related object (e.g.
the folder a document lives in) and evaluates `viewer` *there*. So
"viewers of a doc include viewers of its parent folder" becomes
`permission view = viewer | parent->viewer`.

## Tuple syntax

Runtime relationships use the form:

```
<namespace>:<id>.<relation>@<subject>
```

where subject is one of:

- `<namespace>:<id>` — a concrete subject
- `<namespace>.*` — the wildcard
- `<namespace>:<id>.<relation>` — a userset

See [`@maroonedsoftware/permissions`](../permissions/README.md) for the
authoritative spec, `parseTuple` / `stringifyTuple` round-tripping, and
the underlying check semantics.

## Why dots?

Two separators with distinct jobs:

- `:` is for **runtime identity** — binds a concrete id to a type
  (`user:alice`, `doc:d1`), and inside the DSL introduces a relation's
  subject-type list (`relation editor: user, ...`).
- `.` is for **schema-level scoping** — names a relation or wildcard *on* a
  type (`user.*`, `document.editor`, `doc:d1.owner`).

This matches the rest of the codebase's dot-notation convention. Coming
from Zanzibar/SpiceDB? Translate `#` → `.` and `:*` → `.*` — the structure
is identical. Object ids may contain dots safely; `:` unambiguously starts
the id segment.

## Config

`permissions.config.json` (per app):

```json
{
  "rootDir": "../../",
  "patterns": ["apps/api/permissions/**/*.perm"],
  "prettier": true,
  "output": {
    "baseDir": "apps/api/",
    "namespace": "src/modules/permissions/generated/{filename}.ts",
    "model": "src/modules/permissions/generated/index.ts"
  }
}
```

Each input namespace becomes `<output.namespace>` (with `{filename}`
replaced by the namespace name). The aggregate `output.model` re-exports
each namespace and constructs an `AuthorizationModel`.

## CLI

```
pdsl compile [--config <path>]            # default: compile .perm files to TypeScript
pdsl validate <pattern...>                # run assertions in one or more .perm.yaml fixtures
pdsl check <fixture> <relationship>       # check a single relationship against a fixture
pdsl explain <fixture> <relationship>     # same as `check --explain` — prints a trace tree
```

Examples:

```sh
pdsl validate 'tests/**/*.perm.yaml'
pdsl check examples/document.perm.yaml 'doc:readme.view@user:bob'
pdsl explain examples/document.perm.yaml 'doc:readme.view@user:bob'
```

`compile` is the default when no subcommand is given (so existing
`pdsl --config foo.json` invocations keep working).

## Fixture format

`pdsl validate` consumes a SpiceDB-style YAML file pairing a `.perm`
schema with a set of relationships and assertions:

```yaml
schemaFile: ./document.perm

relationships: |-
  doc:readme.parent@folder:docs
  doc:readme.owner@user:alice
  folder:docs.viewer@user:carol

assertions:
  assertTrue:
    - doc:readme.edit@user:alice
    - doc:readme.view@user:carol
  assertFalse:
    - doc:readme.edit@user:bob

validation:
  doc:readme.view:
    - "[user:alice] is <doc:readme.owner>"
    - "[user:carol] is <folder:docs.viewer>"
```

- `schemaFile` (or inline `schema:` source) — the `.perm` schema to compile
- `relationships` — one tuple per line in canonical form; blank lines and `#` comments allowed
- `assertions.assertTrue` / `assertions.assertFalse` — relationship strings expected to evaluate ALLOWED / DENIED
- `validation` — SpiceDB-style expected-relations mapping `<object>.<permission>` to one or more `[subject] is <via>` paths; the runner verifies each subject is allowed but does not yet enforce the `via` edge match

Running `pdsl validate <pattern>` loads every matching fixture, runs
its assertions, prints a TAP-like report, and exits non-zero on any
failure. See [`examples/document.perm.yaml`](./examples/document.perm.yaml)
for a working fixture.

## Programmatic API

The fixture runner is also exposed as a library:

```ts
import { loadFixture, runFixture, explainRelationship } from '@maroonedsoftware/permissions-dsl';
import { formatTrace } from '@maroonedsoftware/permissions';

const fixture = await loadFixture('tests/document.perm.yaml');
const report = await runFixture(fixture);
if (report.summary.failed > 0) {
  console.error(`${report.summary.failed} assertions failed`);
}

const { allowed, trace } = await explainRelationship(fixture, 'doc:readme.view@user:bob');
console.log(formatTrace(trace));
```

Useful inside Vitest/Jest suites when you want to assert authorization
behavior alongside the rest of your application tests, without spinning
up a database.
