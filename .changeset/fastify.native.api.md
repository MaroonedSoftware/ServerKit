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

Fastify's own logging is bridged onto the ServerKit `Logger` by the new `createFastifyLogger`, so
startup lines, `request.log`, and plugin warnings go where the application logs instead of to a
separate pino instance, and Fastify's duplicate per-request lines are silenced. `request.id` is now
resolved from `X-Request-Id` by the builder's `genReqId` and is the source of `request.requestId`,
so Fastify's request logging and ServerKit's agree on the id. Pass `fastify.logger`,
`fastify.loggerInstance`, or `fastify.genReqId` to override any of it.

Routes are now ordinary Fastify plugins. `ServerKitRouter` and its types are removed, along with
`ServerKitMiddleware`, `ServerKitRouteHandler`, `sendJson`, and the `requestPath` /
`requestMediaType` / `requestBodyLength` / `requestHeader` accessors, which existed only to
re-create Koa's request API. `setupRoutes` now takes route plugins, each optionally wrapped as
`{ plugin, prefix }`. Route guards (`requirePolicy`, `requireSignature`, `bodyParserMiddleware`)
are typed as Fastify hook handlers and go in a route's `preHandler` (or `onRequest`) array.
`serverFeedRouter` becomes `serverFeedRoutes` and returns a route plugin, guarding the stream in
`onRequest` so an unauthorised client is rejected before the socket is taken over.

Bodies are parsed through Fastify's content-type parser rather than a per-route middleware.
`bodyParserPlugin` installs ServerKit's DI parsers as the server's parser and gates each request
on the route's `config.body` allow-list, so the parsed value arrives on Fastify's own
`request.body` and `request.parsedBody` is gone. `bodyParserMiddleware` is removed; a route now
declares `{ config: { body: ['application/json'] } }` instead. The 400 / 411 / 415 / 422 contract
is unchanged, `GET`, `HEAD`, and `TRACE` are exempt from the 411 since Fastify never parses them,
and Fastify's `bodyLimit` now acts as a `Content-Length` pre-check answering 413. The ceiling
enforced while reading is still the parser's own option, such as `JsonParserOptions.limit`.

Add the `@maroonedsoftware/fastify/zod` subpath: `zodPlugin` installs Fastify's validator and
serializer compilers backed by `@maroonedsoftware/zod`, and `ZodTypeProvider` infers a route's
request and response types from its Zod schemas. Validation hands the handler the schema's output
type and renders a failure through `errorPlugin` with the same field map `parseAndValidate`
produces; responses are compiled once at boot with `fast-json-stringify`. `@maroonedsoftware/zod`,
`zod`, and `fast-json-stringify` are optional peers, reachable only through the subpath.

`corsPlugin` no longer wraps `@fastify/cors` with its own origin matcher, since that plugin already
matches strings, RegExps, and arrays. Options now pass through unchanged, which changes two
behaviours: with no `origin` the response header is a literal `*` rather than the reflected caller
origin, and a fixed `origin` string is sent on every response rather than only when it equals the
caller's. Pass a one-element array to match instead of sending a fixed value. `CorsOptions` is now
an alias for `FastifyCorsOptions`. The guard refusing `credentials: true` alongside a `'*'` origin
stays, and now also catches the case where `origin` is omitted entirely.

Document and test `trustProxy`. `request.ipAddress` and the rate limiter's bucket key are Fastify's
`request.ip`, so behind a load balancer every client shares one bucket until
`fastify: { trustProxy: true }` is set. The option already worked through the builder's Fastify
options; it now has tests covering both the address and the rate-limit bucketing, and the README
explains why it stays off by default.
