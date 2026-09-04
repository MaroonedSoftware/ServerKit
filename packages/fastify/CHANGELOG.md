# @maroonedsoftware/fastify

## 0.3.2

### Patch Changes

- b2c37da: Export `MFA_SATISFIED_POLICY` (`'auth.session.mfa.satisfied'`) from
  `@maroonedsoftware/authentication`, and use it as the `requirePolicy()` default in
  `@maroonedsoftware/koa` and `@maroonedsoftware/fastify` instead of the private literal each package
  declared for itself.

  The default gate is unchanged; only its source moved. What changes is that code mirroring the HTTP
  default from off the route path — a background job, or a `@maroonedsoftware/mcp` tool enforcing the
  same rule its route does — can reference the constant rather than carrying a copy of the string that
  silently diverges if the default ever changes.

  `MFA_SATISFIED_POLICY` is the only one of the eleven bundled policy names exported this way, because
  it is the only one that is a default rather than an explicit choice at the call site. The others stay
  literals.

- 89b874f: Scrub the `Authorization` credential from `rawHeaders` too, closing a leak in both adapters'
  authentication step.

  `authenticationPlugin` (fastify) and `authenticationMiddleware` (koa) delete the header after handing
  it to `AuthenticationSchemeHandler`, so it cannot be captured by downstream logging. But
  `IncomingMessage.rawHeaders` is a separate array Node fills at parse time and never keeps in sync
  with `headers`, so `delete req.headers.authorization` left the token sitting in `req.rawHeaders`.
  Anything serializing that array — a request logger, an error reporter, a proxy replaying headers —
  still captured it, which is precisely what the delete was there to prevent.

  Both adapters now also call the new `stripRawAuthorizationHeader` from `@maroonedsoftware/servercore`,
  which removes every `Authorization` pair from the array in place. It matches the name
  case-insensitively, only ever at an even index (so a header whose _value_ reads `"authorization"`
  survives), and handles duplicates, including adjacent ones.

  No API change for consumers. Code that was reaching into `rawHeaders` to recover the credential after
  the authentication step will now find nothing there — that was never a supported way to read it, and
  the supported one is an `AuthenticationHandler` registered for the scheme.

- Updated dependencies [892a28b]
- Updated dependencies [b2c37da]
- Updated dependencies [89b874f]
  - @maroonedsoftware/authentication@4.31.0
  - @maroonedsoftware/servercore@0.3.0

## 0.3.1

### Patch Changes

- Updated dependencies [6d66a27]
  - @maroonedsoftware/servercore@0.2.2

## 0.3.0

### Minor Changes

- 1e7b442: Rebuild the adapter on Fastify's own model instead of a transliterated Koa stack.

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

### Patch Changes

- Updated dependencies [0dd2dbb]
- Updated dependencies [d7ea313]
  - @maroonedsoftware/servercore@0.2.1
  - @maroonedsoftware/zod@0.8.0

## 0.2.0

### Minor Changes

- 97a75be: New package: the Fastify counterpart of `@maroonedsoftware/koa`, built on
  `@maroonedsoftware/servercore`.

  - `ServerKitServerBuilder` with the shared module lifecycle (`setup` / `start` / `ready` /
    `shutdown`), bounded graceful shutdown, a `host` option defaulting to every interface, and
    `builder.app` for third-party Fastify plugins and `app.inject()`.
  - The request context on `FastifyRequest` (`container`, `logger`, `requestId`, `correlationId`,
    `parsedBody`, `rawBody`, `authenticationSession`, `reply`, ...) with `ServerKitContext` as the DI
    token for the live request.
  - `errorMiddleware` (ServerKit's error rendering as `setErrorHandler` / `setNotFoundHandler`, with
    Fastify's own 4xx errors mapped to `HttpError`), `serverKitContextMiddleware`, and
    `serverKitDefaultMiddleware`.
  - `ServerKitRouter`, a Koa-style route collector mounted as an encapsulated plugin with
    `preHandler` guards.
  - `bodyParserMiddleware`, lazy per-route body parsing with the shared 400 / 411 / 415 / 422
    contract; Fastify's eager parsers are replaced so `request.raw` stays unread until a route
    parses it.
  - `corsMiddleware`, `rateLimiterMiddleware`, `authenticationMiddleware`, and the `requirePolicy` /
    `requireSignature` route guards, with the same semantics as `@maroonedsoftware/koa`;
    `serverKitDefaultMiddleware` builds the canonical stack (error → context → optional rate limiter
    → cors → authentication).
  - `openSseReply` for Server-Sent Events over a hijacked reply, and a `./serverfeed` subpath with
    `serverFeedRouter` over the `@maroonedsoftware/serverfeed` bus (optional peer), re-exporting
    the shared handler from `@maroonedsoftware/servercore/serverfeed`.
  - `sendJson` and the `requestPath` / `requestMediaType` / `requestBodyLength` / `requestHeader`
    helpers.
  - Re-exports of the shared core, the same set `@maroonedsoftware/koa` exposes.

### Patch Changes

- Updated dependencies [97a75be]
- Updated dependencies [7c99aba]
  - @maroonedsoftware/errors@1.9.1
  - @maroonedsoftware/servercore@0.2.0
  - @maroonedsoftware/appconfig@2.6.1
  - @maroonedsoftware/authentication@4.30.11
  - @maroonedsoftware/policies@0.6.9
