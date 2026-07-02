---
'@maroonedsoftware/koa': minor
---

Add `ServerKitServerBuilder`, a fluent builder that wires an injectkit container, body parsers, middleware, and routes and runs the module `setup`/`start`/`shutdown` lifecycle around a Koa server. Add `serverKitDefaultMiddleware` (error → context → optional rate limiter → CORS → authentication) and a `RateLimiter` DI token that the default stack applies automatically when one is registered.

Expand `defaultParserMappings` to cover binary content types (`application/octet-stream`, `application/pdf`, `application/zip`, `application/gzip`) and to attach per-parser options, with the JSON parsers now wired to `bigIntReviver` so numeric-string bigints round-trip. Each mapping value is now a `ServerKitParserMapping` (`{ parser, options? }`) rather than a bare parser class; consumers that read `defaultParserMappings` directly should access `.parser`.
