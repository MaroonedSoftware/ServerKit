# ServerKit VSCode Extension

Editor support for ServerKit `.perm` files — the surface syntax for
[`@maroonedsoftware/permissions-dsl`](../../packages/permissions-dsl/README.md).

## Features

- Syntax highlighting for `namespace`, `relation`, `permission`, operators
  (`|`, `&`, `-`, `->`), wildcards (`user.*`), and usersets
  (`document.owner`).
- Bracket matching, auto-closing pairs, indent rules, `//` line comments.
- Live diagnostics from the `pdsl` compiler (parse + lower errors surface
  inline as you type), with cross-file namespace references resolved
  against every `.perm` in the workspace.
- Document outline (`namespace → relation/permission`).
- **Permissions Playground** webview — see below.

## Permissions Playground

Run **ServerKit Permissions: Open Playground** from the command palette
(or click the *Open in Playground* CodeLens above any `namespace` /
`permission` declaration) to open an interactive webview bound to the
active `.perm` file.

Inside the panel:

- **Structured tuple builders** for both the relationships seed and the
  check input. Dropdowns are populated from the schema — pick a
  namespace, the relation list narrows to it, and the subject namespace
  narrows to what the relation actually accepts. A
  `concrete | wildcard | userset` segmented toggle exposes the three
  subject shapes.
- **Per-line tuple validation** under the relationships textarea. Each
  non-blank line is parsed on every keystroke; the gutter shows
  `✓ N tuples` when everything's well-formed and a per-line error list
  when something isn't.
- **Check** evaluates against the in-memory repo and renders an
  ALLOWED/DENIED badge plus a full `CheckTrace` — every
  union/intersection/`tupleToUserset` branch, the tuples examined at
  each direct step, and which child caused the verdict.
- **Toolbar actions:**
  - **✨ Seed from schema** — generates one plausible tuple per relation
    using friendly placeholder ids (`user:alice`, `org:acme`, etc.).
  - **📂 Load fixture…** / **💾 Save fixture…** — round-trips with
    `.perm.yaml` files; the saved fixture works directly with
    `pdsl validate` in CI.
  - **🔍 Discover checks** — scans the workspace's `.ts` / `.tsx` files
    for `check()` call sites that import from
    `@maroonedsoftware/permissions`. Each entry shows the file, line,
    and the permission name; clicking one pre-fills the check builder.

## File extension

`.perm`

## Install (local)

```bash
cd apps/vscode-extension
pnpm package
cursor --install-extension serverkit-vscode-extension.vsix
# or:
code --install-extension serverkit-vscode-extension.vsix
```

## Develop

```bash
pnpm dev    # esbuild watch
```

Open this folder in a fresh VSCode window and press `F5` to launch an
Extension Development Host.
