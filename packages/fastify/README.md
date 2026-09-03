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
- `createFastifyLogger`: bridges Fastify's own logging onto the ServerKit `Logger`, so startup
  lines, `request.log`, and plugin warnings land wherever the application logs.
- Routes are plain Fastify plugins passed to `setupRoutes`, optionally mounted under a prefix.
- `bodyParserMiddleware`: per-route, content-type-driven body parsing into `request.parsedBody`
  with the shared 400 / 411 / 415 / 422 contract. Fastify's eager parsers are replaced by a lazy
  catch-all so the raw stream is untouched until a route asks for it.
- `corsPlugin` (`@fastify/cors` with `'*'`, exact, and RegExp origins), `rateLimiterPlugin`
  (per-IP `rate-limiter-flexible`, 429 with `retry-after` / `x-ratelimit-*`), and
  `authenticationPlugin` (resolves `Authorization` through the registered
  `AuthenticationSchemeHandler` into `request.authenticationSession`, skipping `anonymousPaths`).
- `requirePolicy` and `requireSignature` route guards, with the same semantics as the Koa package.
- `openSseReply`: Server-Sent Events over a hijacked reply, with heartbeat, backpressure, and
  lifecycle-signal drain from the shared transport.
- `@maroonedsoftware/fastify/serverfeed`: `serverFeedRoutes`, an authenticated SSE endpoint over
  the `@maroonedsoftware/serverfeed` realtime bus (optional peer).
- Re-exports of the shared core: `ServerKitModule`, the parsers and `defaultParserMappings`,
  `ServerKitBodyParser`, the signature policy, `RateLimiter`, and the SSE transport.

## Usage

### Basic setup

```typescript
import { ServerKitServerBuilder, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/fastify';
import type { FastifyPluginAsync } from 'fastify';

const invoiceRoutes: FastifyPluginAsync = async app => {
  app.post('/invoices', { preHandler: [bodyParserMiddleware(['application/json']), requirePolicy()] }, async request => {
    const body = await parseAndValidate(request.parsedBody, CreateInvoice);
    return request.container.get(InvoiceService).create(body);
  });
};

const builder = new ServerKitServerBuilder();
await builder.setup(config, logger, modules);
builder.setupPlugins().setupRoutes([{ plugin: invoiceRoutes, prefix: '/api' }]);
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

### Routes

A route plugin is an ordinary Fastify plugin. Guards are Fastify hook handlers listed in the
route's `preHandler`, in order, and throwing an `HttpError` rejects the request. Route plugins are
encapsulated, so a hook one adds applies only to its own routes:

```typescript
const adminRoutes: FastifyPluginAsync = async app => {
  app.addHook('onRequest', requirePolicy({ policy: 'auth.session.assurance.level' }));
  app.get('/users', async request => request.container.get(UserService).list());
};

builder.setupRoutes([{ plugin: adminRoutes, prefix: '/admin' }]);
```

Use `onRequest` rather than `preHandler` when a request must be rejected before its body is read.

### Logging

Fastify's logger is the ServerKit `Logger`, bridged by `createFastifyLogger`, so there is no second
pino instance to configure. `request.log` is Fastify's per-request child logger and
`request.logger` is the request-scoped injectkit `Logger`; both carry the same request id, because
`request.id` is resolved from `X-Request-Id` (or generated) by the same servercore helper the
context plugin uses. Fastify's own per-request lines are silenced, since ServerKit logs requests
itself. Pass `fastify: { logger: ... }` or `fastify: { loggerInstance: ... }` to opt out, and
`fastify: { genReqId: ... }` to control the id.

### Reaching the Fastify instance

`builder.app` is the underlying `FastifyInstance` for plugins ServerKit does not wrap (OpenAPI,
static files, websockets) and for `app.inject()` in tests. Requests reaching routes registered
there still carry the ServerKit context once `setupPlugins` has run.

### Authentication and authorization

```typescript
builder.setupPlugins(container => serverKitDefaultPlugins(container, { authentication: { anonymousPaths: ['/health', /^\/public\//] } }));

app.get('/profile', { preHandler: [requirePolicy()] }, handler); // default 'auth.session.mfa.satisfied' gate
app.post('/mfa/enroll', { preHandler: [requirePolicy({ policy: false })] }, handler); // valid session only
app.post('/webhooks/github', { preHandler: [bodyParserMiddleware(['application/json']), requireSignature('webhook')] }, handler);
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

app.get('/events', async (_request, reply) => {
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
import { serverFeedRoutes } from '@maroonedsoftware/fastify/serverfeed';

builder.setupRoutes([serverFeedRoutes({ signal: builder.lifecycleSignal })]);
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
| `requestId`             | `string`                | Fastify's `request.id`, from `X-Request-Id` or generated |
| `rawBody`               | `BinaryLike`            | Raw body bytes, after `bodyParserMiddleware` |
| `parsedBody`            | `unknown`               | Parsed body, after `bodyParserMiddleware`    |
| `authenticationSession` | `AuthenticationSession` | Set by `authenticationPlugin`            |
| `reply`                 | `FastifyReply`          | The paired reply, for injected services      |

### Server builder

- `new ServerKitServerBuilder(options?)`: `{ host?: string; fastify?: FastifyServerOptions }`.
- `setup(config, logger, modules, parserMappings?)`, `setupPlugins(factory?)`,
  `setupRoutes(routes)`, `start(port, options?)`, `whenReady()`, `lifecycleSignal`, `app`.

### Plugins and guards

- `serverKitPlugin(name, plugin)` for a custom stack step.
- `errorPlugin(container)`, `serverKitContextPlugin(container)`, `corsPlugin(options?)`,
  `rateLimiterPlugin(rateLimiter)`, `authenticationPlugin(options?)`,
  `serverKitDefaultPlugins(container, options?)`.
- `bodyParserMiddleware(contentTypes)`, `requirePolicy(options?)`, `requireSignature(optionsKey, options?)`.
- `normalizeFastifyError(error)`: the Fastify-to-`HttpError` mapping the error handler applies.

### Helpers

- `ServerKitRoutes` and `ServerKitRouteMount` for typing route plugins passed to `setupRoutes`.
- `openSseReply(reply, options?)`; the SSE types and frame helpers are re-exported from servercore.
- `@maroonedsoftware/fastify/serverfeed`: `serverFeedRoutes(options?)`, `ServerFeedRoutesOptions`,
  plus `handleServerFeed`, `ServerFeedContext`, and `serverFeedFilterFromQuery` re-exported from
  `@maroonedsoftware/servercore/serverfeed`.

## License

MIT
