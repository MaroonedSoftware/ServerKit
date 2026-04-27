---
'@maroonedsoftware/koa': minor
---

Expose `ServerKitContext` as an injectkit token. `serverKitContextMiddleware` now registers the live Koa context against it in the request-scoped container, so request-scoped services can declare `ServerKitContext` as a constructor dependency.
