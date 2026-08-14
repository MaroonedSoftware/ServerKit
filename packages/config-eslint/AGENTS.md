# AGENTS.md — @repo/config-eslint

Machine-oriented guide for AI agents. Repo-wide conventions live in the
[root AGENTS.md](../../AGENTS.md).

## Purpose

The shared ESLint flat configs every package in this monorepo extends. Two configs: `base.js` for
server packages and `react-internal.js` for anything with React.

**Private and workspace-only.** It is not published, and it is consumed by _reference from an
`eslint.config.js`_, not by import from application code. There is no runtime API to document.

## Install

Not installable. It is a workspace package (`"private": true`) consumed as
`"@repo/config-eslint": "workspace:*"` in a package's `devDependencies`.

## Position in the graph

- **Depends on:** nothing internal. Dev-only externals: `@eslint/js`, `eslint`,
  `eslint-config-prettier`, `eslint-plugin-only-warn`, `eslint-plugin-react`,
  `eslint-plugin-react-hooks`, `eslint-plugin-turbo`, `globals`, `typescript`, `typescript-eslint`.
- **Depended on by:** every package in `packages/*` and `apps/*`, as a dev dependency.
- **Subpath exports:**
  - `./base.js` — the server config.
  - `./react-internal.js` — `base.js` plus the React and React-hooks plugins.

Note there is no `.` export. The file extension is part of the specifier.

Directory name exception: `config-eslint` predates the no-hyphens rule. Its _contents_ follow it.

## API surface

Two flat-config arrays, both default exports typed `import("eslint").Linter.Config[]`.

### `./base.js`

Composed of, in order: `js.configs.recommended`, `eslint-config-prettier`,
`tseslint.configs.recommended`, the turbo plugin, the only-warn plugin, a rules block, a
JS-globals block, and an ignores block.

| Rule                                      | Level                                |
| ----------------------------------------- | ------------------------------------ |
| `turbo/no-undeclared-env-vars`            | warn                                 |
| `@typescript-eslint/no-unused-vars`       | warn, with `argsIgnorePattern: '^_'` |
| `@typescript-eslint/no-explicit-any`      | warn                                 |
| `@typescript-eslint/no-empty-object-type` | warn                                 |
| `@typescript-eslint/no-empty-interface`   | warn                                 |

Ignored: `dist/**`, `node_modules/**`, `coverage/**`, `bin/**`, `tests/**`.

`**/*.{mjs,cjs,js}` files get Node globals.

### `./react-internal.js`

Spreads `base.js`, then re-adds `js.configs.recommended`, `eslint-config-prettier`, and
`tseslint.configs.recommended`, and layers on `eslint-plugin-react` and `eslint-plugin-react-hooks`.

## Canonical usage

Every package's `eslint.config.js` is the same three lines:

```javascript
//  @ts-check

import base from '@repo/config-eslint/base.js';

/** @type {import("eslint").Linter.Config[]} */
export default [...base];
```

React packages substitute `@repo/config-eslint/react-internal.js`.

## Rules for generated code

- A new package gets an `eslint.config.js` that spreads `base.js` and nothing else. Per-package rule
  overrides belong in that file only when they are genuinely package-specific.
- Do not add rules here to work around one package's code. Fix the code.
- Use the `.js` extension in the import specifier — `@repo/config-eslint/base.js`, not
  `@repo/config-eslint/base`. Those are the literal export keys.
- Reach for `react-internal.js` only in `apps/*`. No package in `packages/*` uses React.
- Suppress a rule at the call site with a targeted `eslint-disable-next-line` and a comment
  explaining why, rather than downgrading it globally. Several such suppressions in the repo
  (declaration merging in `logger`, `jobbroker`, `koa`) are load-bearing.

## Gotchas

- **`eslint-plugin-only-warn` downgrades every error to a warning.** Nothing ESLint reports is ever
  an error at the rule level. What actually fails CI is the `--max-warnings=0` flag in each
  package's `build:ci` script. Removing that flag makes linting advisory with no visible signal.
- **`tests/**` is ignored.** Test files are not linted at all, only type-checked by Vitest's
  transform. Do not expect lint feedback there.
- **`bin/**` is ignored** too, which matters for `johnny5`.
- **`react-internal.js` re-applies three configs already in `base.js`.** Harmless in flat config
  (later entries win) but it means a rule set twice is resolved by order, not by merge.
- **This is a dev dependency, not a peer.** Each consuming package installs it, and the versions
  pinned here are the versions the whole repo lints with.

## Working inside this package

```
base.js            The server flat config
react-internal.js  base.js + React plugins
package.json       exports map — the two file specifiers
```

There is no `src/`, no build step, and no tests. The files are shipped as-is.

Invariants a change must not break:

- The `exports` map keys carry the `.js` extension; every consuming `eslint.config.js` imports them
  literally.
- A rule added here applies to all 26 packages plus the apps at once. Add rules at the `warn` level
  and expect `--max-warnings=0` in CI to make them blocking immediately.
- `only-warn` plus `--max-warnings=0` is the enforcement mechanism. Changing either half changes
  what CI catches, across the whole repo.
- The package stays `private: true`.

This package is private, so a change here does **not** need a changeset.
