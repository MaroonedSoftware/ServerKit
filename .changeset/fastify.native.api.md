---
'@maroonedsoftware/fastify': minor
---

Rebuild the adapter on Fastify's own model instead of a transliterated Koa stack.

The server stack is now a list of `fastify-plugin`-wrapped plugins registered in order, replacing
the `(app: FastifyInstance) => void` "middleware" list applied in a loop. `setupMiddleware` becomes
`setupPlugins`, and each step is renamed to match: `errorMiddleware` to `errorPlugin`,
`serverKitContextMiddleware` to `serverKitContextPlugin`, `corsMiddleware` to `corsPlugin`,
`rateLimiterMiddleware` to `rateLimiterPlugin`, `authenticationMiddleware` to
`authenticationPlugin`, and `serverKitDefaultMiddleware` to `serverKitDefaultPlugins`. The
`ServerKitMiddleware` type is replaced by `ServerKitPlugin`, and a new `serverKitPlugin(name, fn)`
helper wraps a custom step so its hooks apply to every route rather than being encapsulated.

`corsPlugin` now registers `@fastify/cors` through `register` from inside its own plugin rather
than calling it as a bare function against the root instance. Plugin load order keeps the CORS
hook ahead of authentication, so a preflight is still answered before any scheme handler runs.

The error and not-found handlers are async and return the reply, so Fastify tracks completion,
instead of firing `reply.send` and discarding the result.
