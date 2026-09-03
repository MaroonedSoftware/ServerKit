# @maroonedsoftware/servercore

The framework-agnostic core under ServerKit's HTTP adapters. It holds everything an HTTP layer
needs that does not depend on which framework serves the request: the module lifecycle contract,
content-type-driven body parsers, the error-rendering rules, request identity, rate limiting,
CORS origin matching, the HMAC signature policy, and a Server-Sent Events transport over a raw
Node response.

`@maroonedsoftware/koa` and `@maroonedsoftware/fastify` are both built on this package and
re-export the parts an application touches. Reach for `servercore` directly when you are writing
an adapter for another framework, or a library that must work under either adapter.

## Features

- **Module lifecycle**: the `ServerKitModule` contract (`setup`, `start`, `ready`, `shutdown`)
  and `ServerKitServerBuilderBase`, the abstract server builder that runs it with signal handling
  and bounded graceful shutdown. An adapter implements only `listen`.
- **Body parsing**: `ServerKitBodyParser` dispatching by `Content-Type` to injectable parsers for
  JSON (prototype-pollution safe, bigint reviver), URL-encoded forms, text, multipart, and binary,
  with `defaultParserMappings` and the per-route status contract in `assertBodyExpectation` /
  `parseRouteBody`.
- **Error rendering**: `renderError` and `notFoundBody`, the single place that decides which error
  details reach a client.
- **Request identity**: `resolveRequestIdentity` for `X-Correlation-Id` / `X-Request-Id`.
- **Rate limiting**: the `RateLimiter` DI token and `consumeRateLimit`, producing a 429 with
  `retry-after` and `x-ratelimit-*` headers.
- **CORS origins**: `normalizeCorsOrigins` and `createOriginMatcher` for `'*'`, exact, and RegExp
  allow-lists. Used by the Koa adapter only, since `@koa/cors` takes a string or a resolver
  function; `@fastify/cors` matches strings, RegExps, and arrays itself, so the Fastify adapter
  passes `origin` straight through.
- **Anonymous paths**: `createAnonymousPathMatcher` for routes that skip authentication.
- **Request signatures**: `DefaultSignaturePolicy`, `SignaturePolicyContext`, and
  `assertRequestSignature`, verifying an HMAC over the raw body in constant time.
- **SSE transport**: `openSseStream` with heartbeat, backpressure, and lifecycle-signal drain,
  plus `frameEvent`, `frameComment`, and `resolveLastEventId`.
- **Server feed handler** (`@maroonedsoftware/servercore/serverfeed`): `handleServerFeed` streams
  the `@maroonedsoftware/serverfeed` bus over SSE with replay and resync; the bus is an optional
  peer.

## Installation

```bash
pnpm add @maroonedsoftware/servercore
```

Applications normally do not install this package directly; it arrives as a dependency of
`@maroonedsoftware/koa` or `@maroonedsoftware/fastify`.

## Quick start

### Writing an adapter

```typescript
import http from 'node:http';
import { ServerKitServerBuilderBase } from '@maroonedsoftware/servercore';

class MyServerBuilder extends ServerKitServerBuilderBase {
  private readonly server = http.createServer((req, res) => this.handle(req, res));

  protected listen(port: number, signal: AbortSignal): Promise<http.Server> {
    return new Promise((resolve, reject) => {
      const instance = this.server.listen({ port, signal }, () => resolve(instance));
      instance.once('error', reject);
    });
  }
}

const builder = new MyServerBuilder();
await builder.setup(config, logger, modules); // Logger, AppConfig, parsers, module setup hooks
await builder.start(3000); // listen, start hooks, then the ready phase in the background
```

### Rendering an error in a custom adapter

```typescript
import { renderError, notFoundBody } from '@maroonedsoftware/servercore';

try {
  await handle(req, res);
} catch (error) {
  const { status, body, headers } = renderError(error);
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}
```

### Parsing a body by content type

```typescript
import {
  ServerKitBodyParser,
  ServerKitParserMappings,
  JsonParser,
  JsonParserOptions,
  assertBodyExpectation,
  parseRouteBody,
} from '@maroonedsoftware/servercore';
import typeis from 'type-is';

const mappings = new ServerKitParserMappings();
mappings.set('json', new JsonParser(new JsonParserOptions()));
const parser = new ServerKitBodyParser(mappings);

// Per route: enforce the allow-list, then parse.
const shouldParse = assertBodyExpectation(
  { length: Number(req.headers['content-length'] ?? 0), type: req.headers['content-type'] ?? '', is: types => typeis(req, types) },
  ['application/json'],
);
if (shouldParse) {
  const { parsed, raw } = await parseRouteBody(parser, req);
}
```

### Streaming Server-Sent Events

```typescript
import { openSseStream } from '@maroonedsoftware/servercore';

// Koa: pass the ctx (status/respond are set for you).
const stream = openSseStream(ctx, { signal: lifecycleSignal });
// Fastify: hand over the raw reply and the hijack hook.
const stream = openSseStream({ res: reply.raw, hijack: () => reply.hijack() }, { signal: lifecycleSignal });

stream.event({ id: 1, event: 'tick', data: { at: DateTime.now().toISO() } });
stream.onClose(() => clearInterval(timer));
```

## API

### Lifecycle

- `ServerKitModule<ConfigT>`: `{ name?, setup?(registry, config), start?(container, signal), ready?(container, signal), shutdown?(container) }`.
- `ServerKitServerBuilderBase`: `setup(config, logger, modules, parserMappings?)`, `start(port, options?)`,
  `whenReady()`, `lifecycleSignal`, `protected abstract listen(port, signal)`, `protected shutdown()`.
- `ServerKitStartOptions`, `DEFAULT_SHUTDOWN_GRACE_MS`.

### Body parsing

- `ServerKitParser` (abstract), `ServerKitParserResult`.
- `JsonParser` / `JsonParserOptions`, `TextParser` / `TextParserOptions`, `FormParser` /
  `FormParserOptions`, `MultipartParser`, `BinaryParser` / `BinaryParserOptions`.
- `ServerKitParserMapping`, `defaultParserMappings`.
- `ServerKitParserMappings` (DI map token), `ServerKitBodyParser`, `ServerKitBodySource`.
- `assertBodyExpectation(request, contentTypes)`, `parseRouteBody(parser, source)`, `BodyGateRequest`.

### Errors and identity

- `renderError(error)`, `notFoundBody(url)`, `RenderedError`, `RenderedErrorBody`.
- `resolveRequestIdentity(headers)`, `RequestIdentity`, `CORRELATION_ID_HEADER`, `REQUEST_ID_HEADER`.

### Guards

- `RateLimiter` (DI token), `consumeRateLimit(rateLimiter, key)`.
- `CorsOrigin`, `normalizeCorsOrigins(origin)`, `createOriginMatcher(matchers)` (Koa adapter only).
- `createAnonymousPathMatcher(paths)`.
- `REQUIRE_SIGNATURE_POLICY`, `SignatureOptions`, `SignaturePolicyContext`, `DefaultSignaturePolicy`,
  `SignatureRequest`, `assertRequestSignature(container, request, optionsKey, policy?)`.

### SSE

- `openSseStream(ctx, options?)`, `SseStream`, `SseStreamOptions`, `SseContext`, `SseResponse`.
- `SseFrame`, `frameEvent`, `frameComment`, `firstQueryValue`, `resolveLastEventId`.
- `DEFAULT_SSE_HEARTBEAT_MS`, `DEFAULT_SSE_MAX_BUFFERED_BYTES`.

## Server feed handler

`@maroonedsoftware/servercore/serverfeed` maps the `@maroonedsoftware/serverfeed` realtime bus
onto SSE frames: it replays the backlog from the client's `Last-Event-ID` (or `?lastEventId=`),
emits a `resync` event when the resume point predates the replay buffer, then streams live events
matching the `?source=…&kind=…&level=…&correlationId=…` filter until the socket closes.

```typescript
import { handleServerFeed } from '@maroonedsoftware/servercore/serverfeed';

// Any adapter: build the structural context from its request and reply.
handleServerFeed({ res: reply.raw, hijack: () => reply.hijack(), query: request.query, get: name => request.headers[name] ?? '' }, feed, {
  signal: builder.lifecycleSignal,
});
```

Both adapters ship a ready-made guarded route on top of it: `serverFeedRouter` from
`@maroonedsoftware/koa/serverfeed`, and `serverFeedRoutes` (a Fastify route plugin) from
`@maroonedsoftware/fastify/serverfeed`.

## License

MIT
