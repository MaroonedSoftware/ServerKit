---
'@maroonedsoftware/koa': minor
---

Add `ServerKitRouterType`, the router instance type returned by `ServerKitRouter`, so routers can be typed without importing `@koa/router` directly. `ServerKitServerBuilder.setupRoutes` now accepts `ServerKitRouterType[]`.
