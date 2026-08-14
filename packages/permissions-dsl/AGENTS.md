# AGENTS.md — @maroonedsoftware/permissions-dsl

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

A surface syntax (`.perm`) and compiler for `@maroonedsoftware/permissions`. `.perm` files are
parsed by an Ohm grammar, validated, and lowered into TypeScript that calls the existing
`defineNamespace` / `union` / `intersection` / `exclusion` / `computed` / `tupleToUserset` builders.
SpiceDB-style `.perm.yaml` fixtures assert what the model should allow, and the `pdsl` CLI compiles,
validates, checks, and explains.

Reach for this once a model outgrows a handful of hand-written namespaces — a `.perm` file is much
easier to review than nested builder calls, and fixtures give you regression tests for
authorization. Do **not** reach for it at runtime: this is build-time and tooling only. Runtime
`check()` lives in `@maroonedsoftware/permissions`.

## Install

```bash
pnpm add -D @maroonedsoftware/permissions-dsl
```

A **dev** dependency — it compiles to TypeScript that your app then imports. Runtime dependencies:
`@maroonedsoftware/permissions`, `ohm-js`, `prettier`, `yaml`, `zod`. Binary: `pdsl`.

## Position in the graph

- **Depends on:** `permissions`.
- **Depended on by:** `johnny5` (via its `./permissions` subpath). The VS Code extension in
  `apps/vscode-extension` provides editor support for `.perm` files.
- **Subpath exports:** none, but there are **two build entries**: `src/index.ts` (the programmatic
  API) and `src/cli.ts` (the `pdsl` binary). The build also copies `src/permissions.ohm` into
  `dist/`, so the grammar file ships as a runtime asset.

Directory name exception: `permissions-dsl` predates the no-hyphens rule. Its contents follow it.

## API surface

Everything below is exported from the root barrel.

### Config (`src/config.ts`)

| Export              | Kind      | Shape                                                                                                   | Notes                                                                                |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `PermissionsConfig` | interface | `{ rootDir, patterns, prettier, permissionsImport?, cacheDir?, output: { baseDir, namespace, model } }` | All paths absolute after `loadConfig`. `output.namespace` must contain `{filename}`. |
| `loadConfig`        | function  | `(configPath: string) => Promise<{ config: PermissionsConfig; configPath: string }>`                    | Resolves relative paths against the config file's directory; expands a leading `~`.  |
| `findConfig`        | function  | `(cwd: string) => string \| undefined`                                                                  | Walks up looking for `permissions.config.json`.                                      |

`cacheDir` defaults to `<rootDir>/node_modules/.cache/pdsl`.

### Compiler (`src/compiler.ts`)

| Export            | Kind      | Shape                                                                             | Notes                                                                              |
| ----------------- | --------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `compile`         | function  | `(config: PermissionsConfig, options?: CompileOptions) => Promise<CompileResult>` | Throws `AggregateCompileError` on file errors, plain `Error` when no file matches. |
| `CompileOptions`  | interface | `{ dryRun?: boolean }`                                                            | `dryRun` plans without writing.                                                    |
| `CompileResult`   | interface | Compiled/written file summary                                                     | —                                                                                  |
| `importGenerated` | function  | `(path: string) => Promise<unknown>`                                              | Dynamic import via `pathToFileURL`.                                                |

### Parsing and AST (`src/grammar.ts`, `src/parser.ts`, `src/ast.ts`)

| Export                                                                                         | Kind               | Shape                                                                  | Notes                                   |
| ---------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------- | --------------------------------------- |
| `grammar`                                                                                      | constant           | `ohm.Grammar`                                                          | Built from `src/permissions.ohm`.       |
| `parse`                                                                                        | function           | `(opts: ParseOptions) => FileNode`                                     | Throws `ParseError` with a source span. |
| `ParseOptions`                                                                                 | interface          | `{ source, filename? }`                                                | —                                       |
| `FileNode`, `NamespaceNode`, `RelationNode`, `PermissionNode`, `MemberNode`, `SubjectTypeNode` | interfaces / types | AST nodes, all `extends Located`                                       | Every node carries a `SourceSpan`.      |
| `ExprNode`                                                                                     | type               | `RefNode \| TtuNode \| UnionNode \| IntersectionNode \| ExclusionNode` | The expression tree.                    |
| `Located`, `SourceSpan`, `Position`                                                            | interfaces         | Source position tracking                                               | —                                       |

### Lowering and codegen (`src/lower.ts`, `src/codegen.ts`)

| Export                                            | Kind       | Shape                                                         | Notes                                  |
| ------------------------------------------------- | ---------- | ------------------------------------------------------------- | -------------------------------------- |
| `lower`                                           | function   | `(file: FileNode, opts: LowerOptions) => LowerResult`         | AST → validated namespace definitions. |
| `LowerOptions`, `LowerResult`                     | interfaces | —                                                             | —                                      |
| `renderNamespace`                                 | function   | `(ns: NamespaceNode, opts?: CodegenOptions) => NamespaceFile` | Emits one namespace's TypeScript.      |
| `renderIndex`                                     | function   | `(opts: IndexOptions) => string`                              | Emits the aggregate model file.        |
| `CodegenOptions`, `IndexOptions`, `NamespaceFile` | interfaces | —                                                             | —                                      |

### Diagnostics (`src/diagnostics.ts`)

| Export                  | Kind     | Shape                                              | Notes                                                             |
| ----------------------- | -------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| `CompileError`          | class    | `extends Error`, carries a `SourceSpan`            | —                                                                 |
| `ParseError`            | class    | `extends CompileError`                             | Grammar failures.                                                 |
| `AggregateCompileError` | class    | `extends Error`                                    | Collects errors from every file rather than failing on the first. |
| `formatDiagnostic`      | function | `({ source, filename?, span, message }) => string` | Caret-annotated rendering.                                        |
| `offsetToPosition`      | function | `(source: string, offset: number) => Position`     | —                                                                 |

### Fixtures (`src/fixture.ts`, `src/validate.ts`, `src/yaml.ts`)

| Export                             | Kind       | Shape                                                                                                                                                | Notes                                                                |
| ---------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `FixtureSchema`                    | Zod schema | `{ schemaFile?, schema?, relationships: string, assertions: { assertTrue: string[]; assertFalse: string[] }, validation: Record<string, string[]> }` | Refined: **one of** `schemaFile` or `schema` is required.            |
| `FixtureFile`                      | type       | `z.infer<typeof FixtureSchema>`                                                                                                                      | —                                                                    |
| `loadFixture`                      | function   | `(filename: string) => Promise<LoadedFixture>`                                                                                                       | Parses YAML, compiles the model, seeds an `InMemoryTupleRepository`. |
| `LoadedFixture`                    | interface  | `{ filename, file, schemaSource, schemaFilename, model, repository, relationships, sourceMap }`                                                      | —                                                                    |
| `runFixture`                       | function   | `(fixture: LoadedFixture) => Promise<FixtureReport>`                                                                                                 | Runs every assertion.                                                |
| `FixtureReport`, `AssertionResult` | interfaces | —                                                                                                                                                    | —                                                                    |
| `formatReport`                     | function   | `(report: FixtureReport) => string`                                                                                                                  | `fixture.yaml:12:1 FAIL …` lines.                                    |
| `explainRelationship`              | function   | `(fixture: LoadedFixture, relationship: string) => Promise<{ allowed: boolean; trace: CheckTrace }>`                                                 | Wraps `explain()` from `permissions`.                                |
| `parseRelationships`               | function   | `(text: string) => Array<{ tuple: RelationTuple; line: number }>`                                                                                    | Skips blank and `#` lines.                                           |
| `stringifyFixture`                 | function   | `(file: FixtureFile, relationships: RelationTuple[]) => string`                                                                                      | —                                                                    |
| `FixtureSourceMap`                 | interface  | Index/key → 1-indexed line                                                                                                                           | For editor gutter diagnostics.                                       |
| `validateFile`                     | function   | `(opts: ValidateFileOptions) => ValidateFileResult`                                                                                                  | —                                                                    |

### Cache (`src/cache.ts`)

| Export                                                      | Kind       | Shape                                                            | Notes                                            |
| ----------------------------------------------------------- | ---------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| `CacheManifest`, `CachedFileEntry`, `CachedNamespaceOutput` | interfaces | On-disk incremental-compile manifest                             | —                                                |
| `loadManifest`                                              | function   | `(path: string, configHash: string) => Promise<CacheManifest>`   | Discards the manifest on a config-hash mismatch. |
| `saveManifest`                                              | function   | `(path: string, manifest: CacheManifest) => Promise<void>`       | —                                                |
| `hashString`                                                | function   | `(s: string) => string` — SHA-256 hex                            | —                                                |
| `computeConfigHash`                                         | function   | `(config: PermissionsConfig, compilerVersion: string) => string` | Includes the compiler version.                   |

### CLI

```bash
pdsl compile [--config <path>]   # default when no subcommand is given
pdsl validate <fixture...>
pdsl check <relationship> [--explain]
pdsl explain <relationship>
```

`pdsl --config foo.json` with no subcommand is accepted as legacy shorthand for `compile`.

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

Identifiers are `[a-z][a-z0-9_]*`. `//` line comments. A subject list is the set of **allowed
subject types** for that relation, not a union: `user` permits per-user grants, `user.*` permits the
public all-of-them grant, and `document.editor` permits a userset (group) grant. Listing `user` and
`user.*` together is normal — they authorise two different kinds of tuple.

Operator precedence, low to high: `-`, `|`, `&`, atom (`( … )` / `a->b` / `name`). `-` is binary and
left-associated; `|` and `&` are n-ary. `parent->viewer` walks the `parent` relation to the related
object and evaluates `viewer` there.

## Canonical usage

`permissions.config.json`:

```json
{
  "patterns": ["src/permissions/**/*.perm"],
  "prettier": true,
  "output": {
    "namespace": "src/generated/permissions/{filename}.ts",
    "model": "src/generated/permissions/model.ts"
  }
}
```

```bash
pdsl compile
pdsl validate 'src/permissions/**/*.perm.yaml'
pdsl explain 'document:readme.view@user:alice'
```

A fixture:

```yaml
schemaFile: ./document.perm
relationships: |
  document:readme.parent@folder:docs
  folder:docs.viewer@user:alice
assertions:
  assertTrue:
    - document:readme.view@user:alice
  assertFalse:
    - document:readme.delete@user:alice
```

Programmatic use:

```typescript
import { loadConfig, compile, AggregateCompileError, formatDiagnostic } from '@maroonedsoftware/permissions-dsl';

const { config } = await loadConfig('permissions.config.json');
try {
  const result = await compile(config, { dryRun: false });
} catch (error) {
  if (error instanceof AggregateCompileError) {
    /* render each nested CompileError with formatDiagnostic */
  }
  throw error;
}
```

## Rules for generated code

- Install as a **dev** dependency. The compiled output imports `@maroonedsoftware/permissions`,
  which is the runtime dependency.
- Commit generated files or generate them in CI, but pick one. `compile` deletes generated files
  whose source namespace no longer exists, so a stale checked-in file is not silently kept.
- `output.namespace` must contain the `{filename}` placeholder. `loadConfig` throws without it.
- Run `pdsl validate` in CI alongside your tests. Fixtures are the only regression tests an
  authorization model gets.
- Write assertions as canonical tuple strings (`document:readme.view@user:alice`), the same grammar
  `parseTuple` uses in `@maroonedsoftware/permissions`.
- Use `schemaFile` in a fixture rather than inline `schema`, so the fixture and the compiled model
  cannot drift.
- Reach for `pdsl explain` when an assertion fails. The trace tree tells you which branch denied.
- Do not import this package from application runtime code. Import the _generated_ model instead.
- Handle `AggregateCompileError` rather than assuming the first error is the only one.

## Gotchas

- **The compiler is incremental and disk-cached.** State lives in
  `<rootDir>/node_modules/.cache/pdsl`. The manifest is invalidated by a config hash that includes
  the compiler version, so a version bump forces a full rebuild — but a hand-edited generated file
  is not detected. Delete the cache directory when output looks stale.
- **`compile` throws a plain `Error`, not an `AggregateCompileError`, when no file matches
  `patterns`.** A typo'd glob is a different error class than a broken `.perm` file.
- **A fixture must declare exactly one source** — `schemaFile` **or** inline `schema`. The Zod
  refinement rejects neither; it does not reject both, so an inline `schema` alongside a
  `schemaFile` is accepted and the resolution order is the implementation's, not something to rely
  on.
- **`-` is binary and left-associated, and binds loosest.** `a - b - c` parses as `(a - b) - c`, and
  `a | b - c` parses as `(a | b) - c`, not `a | (b - c)`. Parenthesise when it matters.
- **A subject list is not a union.** `relation viewer: user, user.*` allows two kinds of tuple; it
  does not mean "user or all users" as an expression.
- **`user.*` makes a relation world-grantable.** Omitting it from the subject list is what prevents
  a world-readable tuple. This is easy to add by reflex and hard to notice in review.
- **The grammar ships as a runtime asset.** `src/permissions.ohm` is copied to `dist/` by the build
  script, not bundled by tsup. A build that skips the `cp` produces a package that throws at import.
- **`prettier` is a runtime dependency, not a dev one**, because generated output is formatted with
  it when `config.prettier` is true.
- **Line numbers in `FixtureSourceMap` are 1-indexed and relative to the YAML file**, while
  `parseRelationships` returns lines relative to the heredoc.

## Working inside this package

```
src/
  permissions.ohm  The Ohm grammar (copied to dist/ by the build script)
  grammar.ts       Loads the grammar
  parser.ts        parse(), AST construction
  ast.ts           Node interfaces, SourceSpan, Located
  lower.ts         AST → validated namespace definitions
  codegen.ts       renderNamespace, renderIndex
  compiler.ts      compile() — glob, parse, lower, codegen, cache, write, prune
  config.ts        PermissionsConfig, loadConfig, findConfig
  cache.ts         Incremental-compile manifest
  diagnostics.ts   CompileError, ParseError, AggregateCompileError, formatDiagnostic
  fixture.ts       FixtureSchema, loadFixture, runFixture, explainRelationship, formatReport
  validate.ts      validateFile
  yaml.ts          YAML helpers
  cli.ts           pdsl — the second build entry
  index.ts         Barrel (programmatic API; does not export the CLI)
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- Generated code calls only the **public** builders of `@maroonedsoftware/permissions`. Emitting
  anything that reaches past that API couples the two packages' internals.
- The tuple string grammar is shared with `@maroonedsoftware/permissions` (`parseTuple`,
  `stringifyTuple`) and with the VS Code extension. All three must agree.
- `src/permissions.ohm` must keep being copied into `dist/` by the `build` script. It is not
  bundled.
- `compile` collects errors across files into an `AggregateCompileError` rather than failing on the
  first — editors depend on getting every diagnostic in one pass.
- The `pdsl` binary and the programmatic API are separate tsup entries. `src/index.ts` must not
  import `src/cli.ts`.
- Cache invalidation must keep including the compiler version in the config hash, or an upgrade
  silently reuses output from the previous compiler.

User-visible changes need a changeset in `.changeset/`.
