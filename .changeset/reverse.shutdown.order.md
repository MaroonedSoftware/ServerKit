---
'@maroonedsoftware/koa': patch
---

Run module `shutdown` hooks in reverse registration order, so a module tears down before the modules it depends on.
