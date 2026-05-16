# serverkit-vscode-extension

## 0.0.4

### Patch Changes

- Updated dependencies [caa2438]
  - @maroonedsoftware/permissions-dsl@0.4.0

## 0.0.3

### Patch Changes

- a1c1cac: permissions-dsl: cache compiled outputs, improve diagnostics, and grow the playground UX in the VSCode extension
  - The compiler now stores a manifest under `<rootDir>/node_modules/.cache/pdsl/` (configurable via `cacheDir` in `permissions.config.json`) and skips re-rendering namespaces whose source and visible-namespace set are unchanged. Cache invalidates on compiler version bump or any `output` / `permissionsImport` / `prettier` change.
  - Compile errors are now collected across files and surfaced together as `AggregateCompileError`, instead of failing fast on the first file.
  - Generated TypeScript files whose source namespace no longer exists are removed automatically on the next compile (orphan cleanup).
  - New `validateFile()` helper performs the parse + sibling-merge + lower flow used by the compiler. The VSCode extension language server now calls it instead of re-implementing the pipeline inline.
  - `CompileResult` gained `cached` (namespaces served from the manifest) and `orphaned` (paths removed this run).
  - New `yamlParse` / `yamlStringify` re-exports — passthroughs to the bundled `yaml` package so consumers that already depend on `permissions-dsl` (for the fixture API) don't need a second YAML dependency.
  - VSCode extension: the Permissions Playground gains structured tuple builders (namespace/relation/subject dropdowns scoped to the schema), per-line tuple validation under the relationships textarea, **✨ Seed from schema** / **📂 Load fixture…** / **💾 Save fixture…** / **🔍 Discover checks** toolbar actions, a full-width result section, and a single combined Check button that always renders the trace. Pressing Enter in any builder field runs the check.

- Updated dependencies [a1c1cac]
  - @maroonedsoftware/permissions-dsl@0.3.0

## 0.0.2

### Patch Changes

- Updated dependencies [73b34ea]
- Updated dependencies [73b34ea]
  - @maroonedsoftware/permissions@0.2.0
  - @maroonedsoftware/permissions-dsl@0.2.0
