---
'@maroonedsoftware/servercore': patch
---

Mark the CORS origin helpers (`CorsOrigin`, `normalizeCorsOrigins`, `createOriginMatcher`) as
Koa-only in the docs. `@fastify/cors` matches strings, RegExps, and arrays itself, so the Fastify
adapter passes `origin` through and no longer uses them, and a gotcha warns against reintroducing
the matcher there. The serverfeed line now names `serverFeedRoutes` for Fastify alongside Koa's
`serverFeedRouter`. No runtime change.
