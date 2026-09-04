# @maroonedsoftware/servercore

## 0.3.0

### Minor Changes

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

## 0.2.2

### Patch Changes

- 6d66a27: Mark the CORS origin helpers (`CorsOrigin`, `normalizeCorsOrigins`, `createOriginMatcher`) as
  Koa-only in the docs. `@fastify/cors` matches strings, RegExps, and arrays itself, so the Fastify
  adapter passes `origin` through and no longer uses them, and a gotcha warns against reintroducing
  the matcher there. The serverfeed line now names `serverFeedRoutes` for Fastify alongside Koa's
  `serverFeedRouter`. No runtime change.

## 0.2.1

### Patch Changes

- 0dd2dbb: Update the documentation that named the Fastify adapter's body parsing. The shared body gate and
  parser mappings are now used by `bodyParserPlugin` on Fastify, not a `bodyParserMiddleware`. No
  runtime change.

## 0.2.0

### Minor Changes

- 7c99aba: New package: the framework-agnostic core under ServerKit's HTTP adapters. It extracts from
  `@maroonedsoftware/koa` everything that does not depend on the serving framework so a Fastify
  adapter can share it:

  - `ServerKitModule`, the module lifecycle contract.
  - The body parsers (`JsonParser`, `TextParser`, `FormParser`, `MultipartParser`, `BinaryParser`),
    `defaultParserMappings`, and `ServerKitBodyParser`, which now matches content types with
    `type-is` directly and accepts either a raw `IncomingMessage` or an object carrying one as `req`.
  - `assertBodyExpectation` and `parseRouteBody`, the per-route body status contract
    (400 / 411 / 415 / 422).
  - `renderError` and `notFoundBody`, the error-rendering rules every adapter must apply.
  - `resolveRequestIdentity` for `X-Correlation-Id` / `X-Request-Id`.
  - The `RateLimiter` token and `consumeRateLimit`.
  - `normalizeCorsOrigins`, `createOriginMatcher`, and `createAnonymousPathMatcher`.
  - `SignatureOptions`, `SignaturePolicyContext`, `DefaultSignaturePolicy`, and
    `assertRequestSignature`.
  - `openSseStream` passes a no-op callback to `res.setTimeout(0)`, so the transport also works on
    an injected response (Fastify's `app.inject`) whose `setTimeout` requires one.
  - A `./serverfeed` subpath with `handleServerFeed`, `ServerFeedContext`, and
    `serverFeedFilterFromQuery`; `@maroonedsoftware/serverfeed` is an optional peer.
  - The SSE transport (`openSseStream`, frames, `resolveLastEventId`). `SseContext` gains an optional
    `hijack` hook for frameworks that hand over the raw response explicitly, and its Koa-specific
    `status` field is now optional.
  - `ServerKitServerBuilderBase`, the abstract server lifecycle (DI registration, parser wiring,
    module hooks, signal handling, bounded graceful shutdown). An adapter implements `listen(port,
signal)` and inherits everything else; `finalizeRegistry(registry)` lets it register defaults after the module `setup` hooks. `DEFAULT_SHUTDOWN_GRACE_MS` and `ServerKitStartOptions`
    live here too.

### Patch Changes

- Updated dependencies [97a75be]
  - @maroonedsoftware/errors@1.9.1
  - @maroonedsoftware/appconfig@2.6.1
  - @maroonedsoftware/multipart@1.3.8
  - @maroonedsoftware/policies@0.6.9
