---
'@maroonedsoftware/koa': minor
---

The framework-neutral half of this package now lives in `@maroonedsoftware/servercore` and is
re-exported here by name, so existing imports keep working: `ServerKitModule`, the body parsers
and `defaultParserMappings`, `ServerKitBodyParser` / `ServerKitParserMappings`, the signature
policy (`REQUIRE_SIGNATURE_POLICY`, `DefaultSignaturePolicy`, `SignaturePolicyContext`,
`SignatureOptions`), `RateLimiter`, and the SSE transport.

Behavioural notes:

- `ServerKitBodyParser.parse` now matches content types with `type-is` directly and accepts either
  a raw `IncomingMessage` or any object carrying one as `req` (a Koa context still works).
- `SseContext.status` is optional and the interface gains an optional `hijack()` hook. A Koa
  context still satisfies it unchanged.
- `bodyParserMiddleware`, `errorMiddleware`, `rateLimiterMiddleware`, `corsMiddleware`,
  `authenticationMiddleware`, and `requireSignature` delegate to the shared servercore helpers.
  Their wire behaviour (statuses, bodies, headers) is unchanged.
- `rate-limiter-flexible` is no longer a runtime dependency of this package; it arrives through
  servercore. The parser libraries (`@hapi/bourne`, `raw-body`, `inflation`, `qs`) moved with the
  parsers.
- `ServerKitServerBuilder` now extends `ServerKitServerBuilderBase` from servercore. `start()`
  resolves after the socket is bound **and** every module's `start` hook has run, and rejects if
  one throws (previously it resolved before the hooks ran and a throwing hook was an unhandled
  rejection). `DEFAULT_SHUTDOWN_GRACE_MS` and `ServerKitStartOptions` are re-exported unchanged.
