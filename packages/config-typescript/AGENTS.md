# AGENTS.md — @repo/config-typescript

Machine-oriented guide for AI agents. Repo-wide conventions live in the
[root AGENTS.md](../../AGENTS.md).

## Purpose

The shared `tsconfig` bases every package in this monorepo extends. Two files: `base.json` for
server packages and `react.json` for anything with a DOM.

**Private and workspace-only.** It is not published, and it is consumed by _reference from a
`tsconfig.json`_, not by import. There is no runtime API to document.

## Install

Not installable. It is a workspace package (`"private": true`) consumed as
`"@repo/config-typescript": "workspace:*"` in a package's `devDependencies`.

## Position in the graph

- **Depends on:** nothing. There are no dependencies of any kind.
- **Depended on by:** every package in `packages/*` and `apps/*`, as a dev dependency.
- **Subpath exports:** none — there is no `exports` map. The files are referenced by path in an
  `extends` field: `@repo/config-typescript/base.json`.

Directory name exception: `config-typescript` predates the no-hyphens rule. Its _contents_ follow it.

## API surface

Two `tsconfig` files.

### `base.json`

The compiler options that define what "strict TypeScript" means in this repo:

| Option                           | Value                   |
| -------------------------------- | ----------------------- |
| `strict`                         | `true`                  |
| `noUncheckedIndexedAccess`       | `true`                  |
| `noFallthroughCasesInSwitch`     | `true`                  |
| `noUncheckedSideEffectImports`   | `true`                  |
| `experimentalDecorators`         | `true`                  |
| `emitDecoratorMetadata`          | `true`                  |
| `module` / `moduleResolution`    | `NodeNext`              |
| `target` / `lib`                 | `esnext` / `["esnext"]` |
| `types`                          | `["node"]`              |
| `declaration` / `declarationMap` | `true`                  |
| `sourceMap`                      | `true`                  |
| `isolatedModules`                | `true`                  |
| `esModuleInterop`                | `true`                  |
| `resolveJsonModule`              | `true`                  |
| `skipLibCheck`                   | `true`                  |
| `incremental`                    | `false`                 |
| `ignoreDeprecations`             | `"6.0"`                 |

### `react.json`

Extends `base.json` and switches it to a bundler/browser profile: `jsx: 'react-jsx'`,
`lib: ['es2025', 'DOM', 'DOM.Iterable']`, `types: ['vite/client']`, `target: 'ES2025'`,
`moduleResolution: 'Bundler'`, `module: 'esnext'`, `allowImportingTsExtensions: true`,
`verbatimModuleSyntax: true`, `noEmit: true`.

## Canonical usage

Every package's `tsconfig.json` is the same shape:

```json
{
  "extends": "@repo/config-typescript/base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["./src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

Note `include` covers `./src/**/*` only. `tests/` is deliberately outside it.

## Rules for generated code

- A new package extends `base.json` and sets only `outDir`, `rootDir`, `include`, and `exclude`.
- **Keep `tests/` out of `include`.** That is what makes `tsc --noEmit` type-check shippable code
  only, and it is a repo-wide convention, not a per-package choice.
- Do not loosen a strict option in a package's own `tsconfig.json`. If a rule is genuinely wrong for
  the repo, change it here and deal with all 26 packages.
- `noUncheckedIndexedAccess` means every index access is `T | undefined`. Narrow it; do not reach
  for `!`.
- `react.json` is for `apps/*` only.

## Gotchas

- **`emitDecoratorMetadata` is load-bearing.** InjectKit resolves constructor dependencies from the
  metadata it emits. Turning it off makes every `@Injectable()` class in the repo fail to resolve at
  runtime, with no compile error.
- **`isolatedModules` is on**, which is why the codebase uses const objects instead of `const enum`
  (see `discord`'s `InteractionType`) and `import type` for type-only imports.
- **`skipLibCheck` is on.** Type errors inside dependencies' `.d.ts` files are not reported, so a
  broken upstream type surfaces only where you use it.
- **`incremental: false`** means no `.tsbuildinfo` and a full type-check every time. Slower, but it
  removes a whole class of stale-cache confusion.
- **`declaration: true` here, but the build script also runs `tsc --emitDeclarationOnly`.** tsup
  emits the JS; `tsc` emits the types. Both halves are needed.
- **`react.json` sets `noEmit: true`.** A package extending it cannot build with `tsc` — Vite does
  the emitting.
- **There is no `exports` map**, so the `extends` specifier is a literal file path into the package.

## Working inside this package

```
base.json   The server config
react.json  base.json + DOM/bundler profile
package.json
```

No `src/`, no build step, no tests.

Invariants a change must not break:

- `experimentalDecorators` and `emitDecoratorMetadata` must stay on. DI depends on them.
- A change here applies to all 26 packages plus the apps at once. There is no gradual rollout.
- `tests/` staying outside each package's `include` is the convention that keeps `tsc --noEmit`
  meaningful.
- The package stays `private: true`.

This package is private, so a change here does **not** need a changeset.
