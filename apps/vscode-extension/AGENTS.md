# AGENTS.md — serverkit-vscode-extension

Machine-oriented guide for AI agents. Human prose lives in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

VS Code language support for `.perm` files — the surface syntax of
[`@maroonedsoftware/permissions-dsl`](../../packages/permissions-dsl/AGENTS.md). Three pieces: a
TextMate grammar and language configuration for syntax highlighting, a language server providing
live diagnostics and document symbols across the whole workspace, and a webview playground for
running permission checks against a fixture.

**Private and not published to npm.** It is packaged as a `.vsix` and installed into an editor.
There is no importable API — this is an application, not a library.

## Install

Not installable from npm. Build and install locally:

```bash
pnpm --filter serverkit-vscode-extension package        # produces serverkit.vsix
pnpm --filter serverkit-vscode-extension vscode:install # packages, then installs into Cursor
```

Runtime dependencies: `@maroonedsoftware/permissions`, `@maroonedsoftware/permissions-dsl`,
`vscode-languageclient`, `vscode-languageserver`, `vscode-languageserver-textdocument`. Dev:
`@types/vscode`, `@vscode/vsce`, `esbuild`, `sharp`.

## Position in the graph

- **Depends on:** `permissions`, `permissions-dsl` — as **hard** dependencies, both bundled into the
  output by esbuild.
- **Depended on by:** nothing.
- **Subpath exports:** none. `main` is `./dist/client/extension.js`; VS Code loads it.

## Contribution surface

What the extension registers with VS Code, from `package.json`:

| Contribution            | Value                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| Language id             | `serverkit-permissions`, aliases `ServerKit Permissions` / `permissions`, extension `.perm` |
| Grammar                 | `source.serverkit.permissions` → `./syntaxes/permissions.tmLanguage.json`                   |
| Language configuration  | `./language-configuration/permissions-language-config.json`                                 |
| Command                 | `serverkit.permissions.openPlayground` — "ServerKit Permissions: Open Playground"           |
| Menu                    | Editor title bar, `when: resourceLangId == serverkit-permissions`                           |
| `configurationDefaults` | TextMate token colours for the DSL operators, wildcard, and userset scopes                  |
| Activation              | `onLanguage:serverkit-permissions` and `workspaceContains:**/*.perm`                        |
| Engine                  | `vscode ^1.105.1`                                                                           |

### Language server capabilities

Declared in `src/server/server.ts`:

| Capability                   | Value                                   |
| ---------------------------- | --------------------------------------- |
| `textDocumentSync`           | `Incremental`                           |
| `documentSymbolProvider`     | `true`                                  |
| `workspace.workspaceFolders` | `supported: true`                       |
| Diagnostics                  | Pushed via `connection.sendDiagnostics` |

There is **no** completion, hover, or go-to-definition provider. Diagnostics come from
`validateFile` in `permissions-dsl`, debounced on change, and cleared when a document closes.

`WorkspaceIndex` globs `**/*.perm` across every workspace folder on initialise and revalidates
everything, so a cross-file reference resolves against namespaces defined in other files.

## Build

`esbuild.mjs` produces three bundles, then copies two assets:

| Entry                              | Output                              | Platform / format             |
| ---------------------------------- | ----------------------------------- | ----------------------------- |
| `src/client/extension.ts`          | `dist/client/extension.js`          | node / esm, `vscode` external |
| `src/server/server.ts`             | `dist/server/server.js`             | node / esm, `vscode` external |
| `src/client/playground/webview.ts` | `dist/client/playground/webview.js` | browser / iife                |

Copied assets: `packages/permissions-dsl/dist/permissions.ohm` → `dist/server/permissions.ohm`, and
`src/client/playground/webview.css` → `dist/client/playground/webview.css`.

The node bundles carry a banner that installs a real `require` via `createRequire`, because the
bundled CJS dependencies (`vscode-languageserver` and friends) call `require('node:util')` and
esbuild's ESM shim throws `Dynamic require ... not supported` otherwise.

## Rules for generated code

- **Build `@maroonedsoftware/permissions-dsl` before building this.** `esbuild.mjs` copies
  `permissions-dsl/dist/permissions.ohm` and will fail if it does not exist. Turbo's dependency
  graph handles this for `pnpm build`; a bare `node esbuild.mjs` does not.
- Keep `vscode` in esbuild's `external` list. It is provided by the host at runtime and must never
  be bundled.
- Put anything shared between the client and the server in `src/shared/`. The two are separate
  bundles in separate processes and cannot import each other's internals.
- Reuse `permissions-dsl`'s `validateFile`, `parse`, `formatDiagnostic`, and `explain` rather than
  re-implementing DSL semantics here. Divergence between the editor and the compiler is worse than
  no editor support.
- The extension is `private: true` and its version is a VS Code marketplace version, not an npm one.
- Node bundles are ESM with the `createRequire` banner. A new node entry point needs both.

## Gotchas

- **The `.ohm` grammar is a copied runtime asset, not a bundled module.** It travels from
  `permissions-dsl/dist/` into `dist/server/`. A build that skips the copy produces an extension
  that fails at server startup rather than at build time.
- **The `createRequire` banner is load-bearing.** Remove it and the language server dies on its
  first `require('node:util')` with `Dynamic require ... not supported`, which reads as an unrelated
  bundling problem.
- **`workspaceContains:**/*.perm` activates the extension in any workspace containing a `.perm`
  file**, even if the user never opens one.
- **`WorkspaceIndex` globs every `.perm` file on initialise and revalidates all of them.** On a very
  large workspace that is real startup work, and it happens before the first diagnostic appears.
- **Only diagnostics and document symbols are provided.** Completion and hover are absent, not
  broken — do not "fix" a missing feature that was never registered.
- **`configurationDefaults` writes into the user's `editor.tokenColorCustomizations`.** The
  extension changes global editor colour settings for those scopes, which is unusually invasive for
  a language extension. Any change there affects the user's whole editor.
- **`vscode:install` targets Cursor**, not VS Code — the script shells out to `cursor`. On a machine
  without Cursor it fails.
- **The webview bundle is browser/iife**, not node/esm like the other two. Node APIs are not
  available in it.
- **The grammar file is copied, not watched.** In `--watch` mode the copy runs once at startup, so
  editing the `.ohm` grammar in `permissions-dsl` requires restarting the watch.

## Working inside this package

```
src/
  client/
    extension.ts             Activation, language client startup
    playground.panel.ts      Webview panel host
    playground/webview.ts    Webview script (browser bundle)
    playground/webview.css   Copied to dist by esbuild
  server/
    server.ts                LSP server: capabilities, diagnostics, document symbols
    workspace.index.ts       WorkspaceIndex — globs and tracks every .perm file
  shared/
    playground.protocol.ts   Message contract between the panel and the webview
    offset.ts                Offset/position conversion
syntaxes/permissions.tmLanguage.json
language-configuration/permissions-language-config.json
esbuild.mjs                  Three bundles + two asset copies
scripts/build.icon.mjs       Icon generation via sharp
```

There are no tests in this package.

Invariants a change must not break:

- The editor's understanding of `.perm` must stay identical to the compiler's. Both go through
  `permissions-dsl`; do not fork the grammar or the validation.
- `vscode` stays external; the `.ohm` grammar stays a copied asset; the `createRequire` banner stays
  on the node bundles.
- Client and server communicate only through LSP, and the webview only through the message contract
  in `src/shared/playground.protocol.ts`.
- The TextMate scope names (`keyword.operator.*.permissions`, `constant.language.wildcard.permissions`,
  `entity.name.type.userset.permissions`) are referenced by `configurationDefaults`. Renaming a scope
  in the grammar silently breaks the colours.
- The package stays `private: true`.

This app is private, so a change here does **not** need a changeset.
