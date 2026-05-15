# @maroonedsoftware/permissions-dsl

Surface DSL + compiler (`pdsl`) for `@maroonedsoftware/permissions`. Parses `.perm`
files into TypeScript that calls the existing `defineNamespace`/`union`/
`intersection`/`exclusion`/`computed`/`tupleToUserset` builders.

## Surface syntax

```
namespace document {
  relation parent: folder
  relation owner:  user
  relation editor: user, document#owner
  relation viewer: user, user:*, document#editor
  relation banned: user

  permission edit   = owner | editor
  permission view   = edit | viewer | parent->viewer
  permission delete = edit - banned
}
```

| Symbol | Meaning        | Arity        |
| ------ | -------------- | ------------ |
| `\|`   | union          | n-ary        |
| `&`    | intersection   | n-ary        |
| `-`    | exclusion      | binary, left |
| `->`   | tupleToUserset | binary       |
| `( )`  | grouping       | —            |

Precedence (low → high): `-`, `\|`, `&`, atom (`(...)` / `a->b` / `name`).
Subject lists use commas (a list of allowed types — not a union expression).
Identifiers are lowercase `[a-z][a-z0-9_]*`. `//` line comments.

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
pdsl                   # discover permissions.config.json walking up from cwd
pdsl --config <path>   # explicit config path
```
