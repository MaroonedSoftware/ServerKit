---
'@maroonedsoftware/servercore': minor
---

New package: the framework-agnostic core under ServerKit's HTTP adapters. It extracts from
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
- The SSE transport (`openSseStream`, frames, `resolveLastEventId`). `SseContext` gains an optional
  `hijack` hook for frameworks that hand over the raw response explicitly, and its Koa-specific
  `status` field is now optional.
- `ServerKitServerBuilderBase`, the abstract server lifecycle (DI registration, parser wiring,
  module hooks, signal handling, bounded graceful shutdown). An adapter implements `listen(port,
signal)` and inherits everything else. `DEFAULT_SHUTDOWN_GRACE_MS` and `ServerKitStartOptions`
  live here too.
