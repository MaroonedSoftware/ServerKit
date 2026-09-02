---
'@maroonedsoftware/fastify': minor
---

New package: the Fastify counterpart of `@maroonedsoftware/koa`, built on
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
- `sendJson` and the `requestPath` / `requestMediaType` / `requestBodyLength` / `requestHeader`
  helpers.
- Re-exports of the shared core, the same set `@maroonedsoftware/koa` exposes.
