---
'@maroonedsoftware/servercore': patch
---

Update the documentation that named the Fastify adapter's body parsing. The shared body gate and
parser mappings are now used by `bodyParserPlugin` on Fastify, not a `bodyParserMiddleware`. No
runtime change.

Also mark the CORS origin helpers (`CorsOrigin`, `normalizeCorsOrigins`, `createOriginMatcher`) as
Koa-only. `@fastify/cors` matches strings, RegExps, and arrays itself, so the Fastify adapter now
passes `origin` through and no longer uses them, and a gotcha warns against reintroducing the
matcher there. The serverfeed line now names `serverFeedRoutes` for Fastify alongside Koa's
`serverFeedRouter`. No runtime change.
