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
- `errorPlugin`: ServerKit's error rendering as Fastify's error and not-found handlers, with
  Fastify's own 4xx errors mapped to `HttpError`.
- `serverKitPlugin`: wraps a custom stack step with `fastify-plugin` so its hooks reach every route.
- `ServerKitRouter`: a Koa-style route collector (`get`, `post`, `use`, ...) that mounts as an
  encapsulated Fastify plugin with `preHandler` guards.
- `bodyParserMiddleware`: per-route, content-type-driven body parsing into `request.parsedBody`
  with the shared 400 / 411 / 415 / 422 contract. Fastify's eager parsers are replaced by a lazy
  catch-all so the raw stream is untouched until a route asks for it.
- `corsPlugin` (`@fastify/cors` with `'*'`, exact, and RegExp origins), `rateLimiterPlugin`
  (per-IP `rate-limiter-flexible`, 429 with `retry-after` / `x-ratelimit-*`), and
  `authenticationPlugin` (resolves `Authorization` through the registered
  `AuthenticationSchemeHandler` into `request.authenticationSession`, skipping `anonymousPaths`).
- `requirePolicy` and `requireSignature` route guards, with the same semantics as the Koa package.
- `sendJson`: send a pre-serialized JSON string with the right content type.
- `openSseReply`: Server-Sent Events over a hijacked reply, with heartbeat, backpressure, and
  lifecycle-signal drain from the shared transport.
- `@maroonedsoftware/fastify/serverfeed`: `serverFeedRouter`, an authenticated SSE endpoint over
  the `@maroonedsoftware/serverfeed` realtime bus (optional peer).
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
builder.setupPlugins().setupRoutes([router]);
await builder.start(3000, { shutdownGraceMs: 15_000 });
```

`setupPlugins()` registers the default stack: `errorPlugin` → `serverKitContextPlugin` →
`rateLimiterPlugin` (only when a `RateLimiter` is registered) → `corsPlugin` →
`authenticationPlugin`. Handlers receive `(request, reply)`; return a value to send it, or
write through `reply`.

### The plugin stack

Fastify has no `(ctx, next)` chain. Each step of the ServerKit stack is a Fastify plugin, wrapped
with `fastify-plugin` so its hooks apply to every route rather than being encapsulated. Plugins
load in registration order, so the canonical stack is an ordered list:

```typescript
builder.setupPlugins(container => [
  errorPlugin(container),
  serverKitContextPlugin(container),
  serverKitPlugin('greeting', async app => app.addHook('onRequest', async request => request.logger.info('hello'))),
]);
```

Use `serverKitPlugin(name, fn)` for your own steps. A plain plugin passed here would be
encapsulated and its hooks would never run.

Route guards are `ServerKitRouterMiddleware`, `(request, reply) => Promise<void>`, run as
`preHandler` hooks in the order given: router-wide guards from `router.use(...)` first, then the
route's own, then the handler. Throw an `HttpError` to reject.

### Reaching the Fastify instance

`builder.app` is the underlying `FastifyInstance` for plugins ServerKit does not wrap (OpenAPI,
static files, websockets) and for `app.inject()` in tests. Requests reaching routes registered
there still carry the ServerKit context once `setupPlugins` has run.

### Authentication and authorization

```typescript
builder.setupPlugins(container => serverKitDefaultPlugins(container, { authentication: { anonymousPaths: ['/health', /^\/public\//] } }));

router.get('/profile', requirePolicy(), handler); // default 'auth.session.mfa.satisfied' gate
router.post('/mfa/enroll', requirePolicy({ policy: false }), handler); // valid session only
router.post('/webhooks/github', bodyParserMiddleware(['application/json']), requireSignature('webhook'), handler);
```

`requireSignature` needs `request.rawBody`, so `bodyParserMiddleware` goes first on the route.
`SignatureOptions` (`header`, `secret`, `algorithm`, `digest`) live in `AppConfig` under the key
you pass.

### CORS and rate limiting

```typescript
corsPlugin({ origin: ['https://app.example.com', /\.example\.com$/], credentials: true });
registry.register(RateLimiter).useInstance(new RateLimiterMemory({ points: 100, duration: 60 }));
```

The default stack inserts `rateLimiterPlugin` only when a `RateLimiter` is registered. The CORS
plugin is registered ahead of authentication, so a preflight is answered before any scheme handler
runs.

### Body parsing

Fastify normally parses JSON before any hook runs. ServerKit parses lazily and per route instead:
the builder removes Fastify's parsers and installs a no-op catch-all, and `bodyParserMiddleware`
reads `request.raw` when the route allows a body. Consequences:

- Read `request.parsedBody` (and `request.rawBody`). Fastify's `request.body` stays `undefined`.
- Fastify's `bodyLimit` does not apply; the parser options (`JsonParserOptions.limit`, ...) do.
- A route without `bodyParserMiddleware` never reads its body.

## Server-Sent Events

```typescript
import { openSseReply } from '@maroonedsoftware/fastify';

router.get('/events', async (_request, reply) => {
  const stream = openSseReply(reply, { signal: builder.lifecycleSignal });
  const timer = setInterval(() => stream.event({ event: 'tick', data: { at: DateTime.now().toISO() } }), 1000);
  stream.onClose(() => clearInterval(timer));
});
```

`openSseReply` hijacks the reply and hands the raw socket to the shared SSE transport. Do not
`send` afterwards. Always pass `builder.lifecycleSignal` so shutdown drains open streams instead
of waiting out the grace period, and register cleanup with `stream.onClose`. Headers are flushed
on the first write (an event, a comment, or the heartbeat), not when the stream opens.

## Server feed SSE endpoint

```typescript
import { serverFeedRouter } from '@maroonedsoftware/fastify/serverfeed';

builder.setupRoutes([serverFeedRouter({ signal: builder.lifecycleSignal })]);
```

Mounts `GET /server/feed` (configurable via `path`), guarded by `requirePolicy` (`policy` to
change or `false` for session-only), streaming the `ServerFeed` bus registered in DI (or one from
`resolveFeed`). Clients resume with `Last-Event-ID` or `?lastEventId=` and filter with
`?source=a,b&kind=progress,status&level=warn&correlationId=…`. Requires the optional peer
`@maroonedsoftware/serverfeed`.

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
| `authenticationSession` | `AuthenticationSession` | Set by `authenticationPlugin`            |
| `reply`                 | `FastifyReply`          | The paired reply, for injected services      |

### Server builder

- `new ServerKitServerBuilder(options?)`: `{ host?: string; fastify?: FastifyServerOptions }`.
- `setup(config, logger, modules, parserMappings?)`, `setupPlugins(factory?)`,
  `setupRoutes(routers)`, `start(port, options?)`, `whenReady()`, `lifecycleSignal`, `app`.

### Plugins and guards

- `serverKitPlugin(name, plugin)` for a custom stack step.
- `errorPlugin(container)`, `serverKitContextPlugin(container)`, `corsPlugin(options?)`,
  `rateLimiterPlugin(rateLimiter)`, `authenticationPlugin(options?)`,
  `serverKitDefaultPlugins(container, options?)`.
- `bodyParserMiddleware(contentTypes)`, `requirePolicy(options?)`, `requireSignature(optionsKey, options?)`.
- `normalizeFastifyError(error)`: the Fastify-to-`HttpError` mapping the error handler applies.

### Helpers

- `ServerKitRouter(options?)` and `ServerKitRouterType`.
- `sendJson(reply, serialized, status?)`.
- `openSseReply(reply, options?)`; the SSE types and frame helpers are re-exported from servercore.
- `@maroonedsoftware/fastify/serverfeed`: `serverFeedRouter(options?)`, `ServerFeedRouterOptions`,
  plus `handleServerFeed`, `ServerFeedContext`, and `serverFeedFilterFromQuery` re-exported from
  `@maroonedsoftware/servercore/serverfeed`.
- `requestPath`, `requestMediaType`, `requestBodyLength`, `requestHeader`: Koa-equivalent request
  accessors over a `FastifyRequest`.

## License

MIT
