# @maroonedsoftware/fastify

Fastify server builder, request context, hooks, body parsing, SSE streaming, and utilities for
ServerKit. The Fastify counterpart of `@maroonedsoftware/koa`: the same composition-root story,
module lifecycle, error rendering, body status contract, guards, and SSE transport, expressed as
Fastify hooks and plugins instead of Koa middleware. Both adapters share
[`@maroonedsoftware/servercore`](../servercore/README.md).

## Installation

```bash
pnpm add @maroonedsoftware/fastify fastify @fastify/cors
```

Peer dependencies: `fastify` (v5), `@fastify/cors`.

## Features

- `ServerKitServerBuilder`: DI container setup, module lifecycle (`setup` / `start` / `ready` /
  `shutdown`), bounded graceful shutdown, and a `host` option that binds every interface by default.
- Request context on `FastifyRequest`: request-scoped `container`, `logger`, `requestId`,
  `correlationId`, `userAgent`, `ipAddress`, `parsedBody`, `rawBody`, `authenticationSession`, and
  `reply`, with `ServerKitContext` as the DI token for the live request.
- `errorMiddleware`: ServerKit's error rendering as Fastify's error and not-found handlers, with
  Fastify's own 4xx errors mapped to `HttpError`.
- `ServerKitRouter`: a Koa-style route collector (`get`, `post`, `use`, ...) that mounts as an
  encapsulated Fastify plugin with `preHandler` guards.
- `bodyParserMiddleware`: per-route, content-type-driven body parsing into `request.parsedBody`
  with the shared 400 / 411 / 415 / 422 contract. Fastify's eager parsers are replaced by a lazy
  catch-all so the raw stream is untouched until a route asks for it.
- `sendJson`: send a pre-serialized JSON string with the right content type.
- Re-exports of the shared core: `ServerKitModule`, the parsers and `defaultParserMappings`,
  `ServerKitBodyParser`, the signature policy, `RateLimiter`, and the SSE transport.

## Usage

### Basic setup

```typescript
import { ServerKitServerBuilder, ServerKitRouter, bodyParserMiddleware } from '@maroonedsoftware/fastify';

const router = ServerKitRouter({ prefix: '/api' });

router.post('/invoices', bodyParserMiddleware(['application/json']), async request => {
  const body = await parseAndValidate(request.parsedBody, CreateInvoice);
  return request.container.get(InvoiceService).create(body);
});

const builder = new ServerKitServerBuilder();
await builder.setup(config, logger, modules);
builder.setupMiddleware().setupRoutes([router]);
await builder.start(3000, { shutdownGraceMs: 15_000 });
```

`setupMiddleware()` applies the default stack: `errorMiddleware` then `serverKitContextMiddleware`.
Handlers receive `(request, reply)`; return a value to send it, or write through `reply`.

### Middleware on Fastify

Fastify has no `(ctx, next)` chain. A `ServerKitMiddleware` here is a registration step,
`(app: FastifyInstance) => void`, that installs a hook, an error handler, or a plugin on the root
instance. `setupMiddleware` applies them in order, so the canonical stack is still an ordered list:

```typescript
builder.setupMiddleware(container => [
  errorMiddleware(container),
  serverKitContextMiddleware(container),
  app => app.addHook('onRequest', async request => request.logger.info('hello')),
]);
```

Route guards are `ServerKitRouterMiddleware`, `(request, reply) => Promise<void>`, run as
`preHandler` hooks in the order given: router-wide guards from `router.use(...)` first, then the
route's own, then the handler. Throw an `HttpError` to reject.

### Reaching the Fastify instance

`builder.app` is the underlying `FastifyInstance` for plugins ServerKit does not wrap (OpenAPI,
static files, websockets) and for `app.inject()` in tests. Requests reaching routes registered
there still carry the ServerKit context once `setupMiddleware` has run.

### Body parsing

Fastify normally parses JSON before any hook runs. ServerKit parses lazily and per route instead:
the builder removes Fastify's parsers and installs a no-op catch-all, and `bodyParserMiddleware`
reads `request.raw` when the route allows a body. Consequences:

- Read `request.parsedBody` (and `request.rawBody`). Fastify's `request.body` stays `undefined`.
- Fastify's `bodyLimit` does not apply; the parser options (`JsonParserOptions.limit`, ...) do.
- A route without `bodyParserMiddleware` never reads its body.

## API

### Request context

| Property                | Type                    | Description                                  |
| ----------------------- | ----------------------- | -------------------------------------------- |
| `container`             | `Container`             | Request-scoped DI container                  |
| `logger`                | `Logger`                | Request-scoped logger                        |
| `loggerName`            | `string`                | The request path                             |
| `userAgent`             | `string`                | `User-Agent` header or `''`                  |
| `ipAddress`             | `string`                | Client IP                                    |
| `correlationId`         | `string`                | From `X-Correlation-Id` or generated         |
| `requestId`             | `string`                | From `X-Request-Id` or generated             |
| `rawBody`               | `BinaryLike`            | Raw body bytes, after `bodyParserMiddleware` |
| `parsedBody`            | `unknown`               | Parsed body, after `bodyParserMiddleware`    |
| `authenticationSession` | `AuthenticationSession` | Set by `authenticationMiddleware`            |
| `reply`                 | `FastifyReply`          | The paired reply, for injected services      |

### Server builder

- `new ServerKitServerBuilder(options?)`: `{ host?: string; fastify?: FastifyServerOptions }`.
- `setup(config, logger, modules, parserMappings?)`, `setupMiddleware(factory?)`,
  `setupRoutes(routers)`, `start(port, options?)`, `whenReady()`, `lifecycleSignal`, `app`.

### Middleware and guards

- `errorMiddleware(container)`, `serverKitContextMiddleware(container)`,
  `serverKitDefaultMiddleware(container, options?)`.
- `bodyParserMiddleware(contentTypes)`.
- `normalizeFastifyError(error)`: the Fastify-to-`HttpError` mapping the error handler applies.

### Helpers

- `ServerKitRouter(options?)` and `ServerKitRouterType`.
- `sendJson(reply, serialized, status?)`.
- `requestPath`, `requestMediaType`, `requestBodyLength`, `requestHeader`: Koa-equivalent request
  accessors over a `FastifyRequest`.

## License

MIT
