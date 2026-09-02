---
'@maroonedsoftware/johnny5': patch
---

The `./serverkit` integration takes its `ServerKitModule` type from `@maroonedsoftware/servercore`
instead of `@maroonedsoftware/koa`, so the optional peer is now `servercore`. The integration
works unchanged with modules written for either the Koa or the Fastify adapter.
