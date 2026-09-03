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

Peer dependencies: `fastify` (v5), `@fastify/cors`. Optional: `@maroonedsoftware/serverfeed` for
the `/serverfeed` subpath, and `@maroonedsoftware/zod` plus `zod` (and `fast-json-stringify` for
response serialization) for the `/zod` subpath.

## Features

- `ServerKitServerBuilder`: DI container setup, module lifecycle (`setup` / `start` / `ready` /
  `shutdown`), bounded graceful shutdown, and a `host` option that binds every interface by default.
- Request context on `FastifyRequest`: request-scoped `container`, `logger`, `requestId`,
  `correlationId`, `userAgent`, `ipAddress`, `rawBody`, `authenticationSession`, and
  `reply`, with `ServerKitContext` as the DI token for the live request.
- `errorPlugin`: ServerKit's error rendering as Fastify's error and not-found handlers, with
  Fastify's own 4xx errors mapped to `HttpError`.
- `serverKitPlugin`: wraps a custom stack step with `fastify-plugin` so its hooks reach every route.
- `createFastifyLogger`: bridges Fastify's own logging onto the ServerKit `Logger`, so startup
  lines, `request.log`, and plugin warnings land wherever the application logs.
- Routes are plain Fastify plugins passed to `setupRoutes`, optionally mounted under a prefix.
- `bodyParserPlugin`: body parsing through ServerKit's DI parsers, gated by each route's
  `config.body` allow-list, with the shared 400 / 411 / 415 / 422 contract. The parsed value lands
  on Fastify's own `request.body`, the raw bytes on `request.rawBody`.
- `corsPlugin` (`@fastify/cors` with `'*'`, exact, and RegExp origins), `rateLimiterPlugin`
  (per-IP `rate-limiter-flexible`, 429 with `retry-after` / `x-ratelimit-*`), and
  `authenticationPlugin` (resolves `Authorization` through the registered
  `AuthenticationSchemeHandler` into `request.authenticationSession`, skipping `anonymousPaths`).
- `requirePolicy` and `requireSignature` route guards, with the same semantics as the Koa package.
- `openSseReply`: Server-Sent Events over a hijacked reply, with heartbeat, backpressure, and
  lifecycle-signal drain from the shared transport.
- `@maroonedsoftware/fastify/serverfeed`: `serverFeedRoutes`, an authenticated SSE endpoint over
  the `@maroonedsoftware/serverfeed` realtime bus (optional peer).
- `@maroonedsoftware/fastify/zod`: `zodPlugin` and a `ZodTypeProvider`, so routes declare their
  schemas as Zod schemas and get typed request and response shapes (optional peers).
- Re-exports of the shared core: `ServerKitModule`, the parsers and `defaultParserMappings`,
  `ServerKitBodyParser`, the signature policy, `RateLimiter`, and the SSE transport.

## Usage

### Basic setup

```typescript
import { ServerKitServerBuilder, requirePolicy } from '@maroonedsoftware/fastify';
import type { FastifyPluginAsync } from 'fastify';

const invoiceRoutes: FastifyPluginAsync = async app => {
  app.post('/invoices', { config: { body: ['application/json'] }, preHandler: [requirePolicy()] }, async request => {
    const body = await parseAndValidate(request.body, CreateInvoice);
    return request.container.get(InvoiceService).create(body);
  });
};

const builder = new ServerKitServerBuilder();
await builder.setup(config, logger, modules);
builder.setupPlugins().setupRoutes([{ plugin: invoiceRoutes, prefix: '/api' }]);
await builder.start(3000, { shutdownGraceMs: 15_000 });
```

`setupPlugins()` registers the default stack: `errorPlugin` → `serverKitContextPlugin` →
`bodyParserPlugin` → `rateLimiterPlugin` (only when a `RateLimiter` is registered) → `corsPlugin` →
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
app.post('/webhooks/github', { config: { body: ['application/json'] }, preHandler: [requireSignature('webhook')] }, handler);
```

`requireSignature` needs `request.rawBody`, so the route must accept the payload through
`config.body`.
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

`corsPlugin` passes its options to `@fastify/cors` unchanged, so that plugin's origin semantics
apply: a fixed string is sent on every response and left for the browser to enforce, an array or
RegExp reflects the caller's origin only when it matches, and no `origin` at all means a literal
`*`. The one thing added is a guard that refuses `credentials: true` alongside a `*` origin, which
no browser honours.

### Running behind a proxy

`request.ipAddress` and the rate limiter's bucket key are both Fastify's `request.ip`, which is the
socket address. Behind a load balancer that is the proxy, so every client shares one rate-limit
bucket. Turn on Fastify's proxy support to read the forwarded address instead:

```typescript
new ServerKitServerBuilder({ fastify: { trustProxy: true } });
```

This is off by default deliberately. If nothing in front of the app strips `X-Forwarded-For`, any
caller can set it and take a fresh rate-limit bucket per request, so enable it only when a proxy
you control sets the header. `trustProxy` also accepts an address, a subnet, a list, or a hop
count when you need to be specific about which proxies to believe.

### Body parsing

Bodies are parsed by ServerKit's own parsers, chosen by `Content-Type` from the DI-registered
mappings, and each route declares what it accepts:

```typescript
app.post('/invoices', { config: { body: ['application/json'] } }, async request => request.body);
```

- The parsed value is on `request.body` and the raw bytes on `request.rawBody`.
- A route with no `config.body` accepts no body: sending one is a 400. A missing required body is
  a 411, a disallowed type a 415, an unreadable one a 422.
- Fastify's `bodyLimit` acts only as a `Content-Length` pre-check (a 413). The ceiling enforced
  while reading is the parser's own option, e.g. `JsonParserOptions.limit`.
- `GET`, `HEAD`, and `TRACE` are never parsed by Fastify, so they carry no `request.body`.

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

## Zod schemas

```typescript
import { zodPlugin, type ZodTypeProvider } from '@maroonedsoftware/fastify/zod';

builder.setupPlugins(container => [...serverKitDefaultPlugins(container), zodPlugin()]);

const userRoutes: FastifyPluginAsync = async instance => {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.post('/users', { config: { body: ['application/json'] }, schema: { body: CreateUser, response: { 200: User } } }, async request => {
    return request.container.get(UserService).create(request.body); // request.body is typed
  });
};
```

`zodPlugin` installs Fastify's validator and serializer compilers. Validation runs the schema and
hands the handler its **output** type, so coercions and transforms apply, and a failure renders
through `errorPlugin` with the same field map `parseAndValidate` produces. Responses are compiled
once at boot into a `fast-json-stringify` serializer per status code.

Two limits worth knowing: the validator is synchronous, as Fastify requires, so a schema with async
refinements has to be validated in the handler instead; and the serializer does not validate, so a
value the response schema does not describe has its unknown properties dropped silently. A schema
JSON Schema cannot express, such as `z.date()`, fails at boot rather than per request.

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
| `ipAddress`             | `string`                | Client IP, forwarded-aware only with `trustProxy` |
| `correlationId`         | `string`                | From `X-Correlation-Id` or generated         |
| `requestId`             | `string`                | Fastify's `request.id`, from `X-Request-Id` or generated |
| `rawBody`               | `BinaryLike`            | Raw body bytes, after `bodyParserPlugin`     |
| `authenticationSession` | `AuthenticationSession` | Set by `authenticationPlugin`            |
| `reply`                 | `FastifyReply`          | The paired reply, for injected services      |

### Server builder

- `new ServerKitServerBuilder(options?)`: `{ host?: string; fastify?: FastifyServerOptions }`.
- `setup(config, logger, modules, parserMappings?)`, `setupPlugins(factory?)`,
  `setupRoutes(routes)`, `start(port, options?)`, `whenReady()`, `lifecycleSignal`, `app`.

### Plugins and guards

- `serverKitPlugin(name, plugin)` for a custom stack step.
- `errorPlugin(container)`, `serverKitContextPlugin(container)`, `corsPlugin(options?)`,
  `rateLimiterPlugin(rateLimiter)`, `authenticationPlugin(options?)`, `bodyParserPlugin()`,
  `serverKitDefaultPlugins(container, options?)`.
- `requirePolicy(options?)`, `requireSignature(optionsKey, options?)`.
- `normalizeFastifyError(error)`: the Fastify-to-`HttpError` mapping the error handler applies.

### Helpers

- `ServerKitRoutes` and `ServerKitRouteMount` for typing route plugins passed to `setupRoutes`.
- `openSseReply(reply, options?)`; the SSE types and frame helpers are re-exported from servercore.
- `@maroonedsoftware/fastify/serverfeed`: `serverFeedRoutes(options?)`, `ServerFeedRoutesOptions`,
  plus `handleServerFeed`, `ServerFeedContext`, and `serverFeedFilterFromQuery` re-exported from
  `@maroonedsoftware/servercore/serverfeed`.
- `@maroonedsoftware/fastify/zod`: `zodPlugin(options?)`, `ZodPluginOptions`, `zodValidatorCompiler()`,
  `zodSerializerCompiler(options?)`, and `ZodTypeProvider`.

## License

MIT
