# ServerKit VSCode Extension

Editor support for ServerKit `.perm` files — the surface syntax for
[`@maroonedsoftware/permissions-dsl`](../../packages/permissions-dsl/README.md).

## Features

- Syntax highlighting for `namespace`, `relation`, `permission`, operators
  (`|`, `&`, `-`, `->`), wildcards (`user.*`), and usersets
  (`document.owner`).
- Bracket matching, auto-closing pairs, indent rules, `//` line comments.
- Live diagnostics from the `pdsl` compiler (parse + lower errors surface
  inline as you type).
- Document outline (`namespace → relation/permission`).

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
