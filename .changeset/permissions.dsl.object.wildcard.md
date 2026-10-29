---
'@maroonedsoftware/permissions-dsl': minor
'serverkit-vscode-extension': patch
---

`.perm` relations accept a trailing `on *` (`relation platform_admin: user on *`), which compiles to `objectWildcard: true` so the relation can hold every-object tuples such as `doc:*.platform_admin@user:alice`. `RelationNode` gains `objectWildcard`, and codegen emits the flag. The VS Code grammar highlights `on *`.
