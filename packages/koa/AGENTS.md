# AGENTS.md — @maroonedsoftware/koa

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

The HTTP layer. `ServerKitServerBuilder` wires an InjectKit container, body parsers, middleware, and
routers, then runs the module lifecycle around a Koa server with graceful shutdown.
`ServerKitContext` is Koa's context extended with a request-scoped container, logger, request and
correlation IDs, the raw and parsed bodies, and the authentication session. On top of that sit the
middleware stack (error, context, rate limit, CORS, authentication), content-type-driven body
parsing, route guards (`requirePolicy`, `requireSignature`), and an SSE transport.

This is where the composition-root story for a ServerKit app lives. It is also the package where
**wiring order is load-bearing** and gets silently wrong.

## Install

```bash
pnpm add @maroonedsoftware/koa koa @koa/router @koa/cors
```

Required peers: `koa`, `@koa/router`, `@koa/cors`. Optional peer:
`@maroonedsoftware/serverfeed` (for the `./serverfeed` subpath).

Runtime dependencies: `appconfig`, `authentication`, `errors`, `logger`, `multipart`, `policies`,
`utilities`, plus `@hapi/bourne`, `co-body`, `inflation`, `injectkit`, `luxon`, `qs`,
`rate-limiter-flexible`, `raw-body`.

## Position in the graph

- **Depends on:** `appconfig`, `authentication`, `errors`, `logger`, `multipart`, `policies`,
  `utilities`.
- **Depended on by:** `scim`, `johnny5`.
- **Subpath exports:**
  - `.` — everything below.
  - `./serverfeed` — the SSE adapter for `@maroonedsoftware/serverfeed`, which is an **optional**
    peer. The adapter lives here rather than in `serverfeed` because framing and connection
    handling are transport concerns and `serverfeed` must stay transport-free.

## API surface

### Context, router, middleware types

| Export                      | Kind                       | Shape                                                                                                                                                                | Notes                                                                          |
| --------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `ServerKitContext`          | interface + abstract class | `extends Context` with `container`, `logger`, `loggerName`, `userAgent`, `ipAddress`, `correlationId`, `requestId`, `rawBody`, `parsedBody`, `authenticationSession` | Declaration-merged so one symbol is both the type and a DI token.              |
| `ServerKitMiddleware`       | type                       | `Middleware<…>` bound to `ServerKitContext`                                                                                                                          | Server-level middleware.                                                       |
| `ServerKitRouterMiddleware` | type                       | `RouterMiddleware<State, Context>`                                                                                                                                   | Route-level middleware.                                                        |
| `ServerKitRouter`           | function                   | `<StateT, ContextT>(options?: RouterOptions) => Router<StateT, ContextT>`                                                                                            | Factory, not a class.                                                          |
| `ServerKitRouterType`       | type                       | `ReturnType<typeof ServerKitRouter>`                                                                                                                                 | Type a router without importing `@koa/router`. Erased/invariant — see Gotchas. |

### Server middleware

| Export                       | Kind                       | Shape                                               | Notes                                                                                        |
| ---------------------------- | -------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `errorMiddleware`            | function                   | `() => ServerKitMiddleware`                         | **Must be first.** Maps errors to responses; emits `error`/`warn` on the app.                |
| `serverKitContextMiddleware` | function                   | `(container: Container) => ServerKitMiddleware`     | **Must be second.** Creates the request scope and registers the live `ctx`. The scope is disposed when the response closes (not when `next()` unwinds, so SSE outlives the handler); resolving from `ctx.container` after that throws. |
| `corsMiddleware`             | function                   | `(options?: CorsOptions) => ServerKitMiddleware`    | `origin` accepts `'*'`, a string, or a `RegExp`.                                             |
| `rateLimiterMiddleware`      | function                   | `(rateLimiter: RateLimiter) => ServerKitMiddleware` | Per-IP; 429 when exceeded.                                                                   |
| `RateLimiter`                | interface + abstract class | `extends RateLimiterAbstract`                       | DI token for a `rate-limiter-flexible` limiter.                                              |
| `authenticationMiddleware`   | function                   | `() => ServerKitMiddleware`                         | Resolves `Authorization` via `AuthenticationSchemeHandler` into `ctx.authenticationSession`. |
| `serverKitDefaultMiddleware` | function                   | `(container: Container) => ServerKitMiddleware[]`   | The canonical stack in canonical order.                                                      |
| `CorsOptions`                | interface                  | `Omit<cors.Options, 'origin'> & { origin }`         | —                                                                                            |

`serverKitDefaultMiddleware` builds: `errorMiddleware()` → `serverKitContextMiddleware(container)` →
`rateLimiterMiddleware(...)` **only if a `RateLimiter` is registered** → `corsMiddleware({ exposeHeaders: ['WWW-Authenticate'] })`
→ `authenticationMiddleware()`.

### Router middleware and policies

| Export                             | Kind      | Shape                                                                                                       | Notes                                                                               |
| ---------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `bodyParserMiddleware`             | function  | `(contentTypes: string[]) => ServerKitRouterMiddleware`                                                     | Parses per `Content-Type` into `ctx.parsedBody`.                                    |
| `requirePolicy`                    | function  | `(options?: RequirePolicyOptions) => ServerKitRouterMiddleware`                                             | 401 on an invalid session; then asserts a policy (403 on deny).                     |
| `RequirePolicyOptions`             | interface | `{ policy?: string \| false }`                                                                              | Default `'auth.session.mfa.satisfied'`. `false` skips the policy check.             |
| `requireSignature`                 | function  | `<TOptions = SignatureOptions>(optionsKey, options?: RequireSignatureOptions) => ServerKitRouterMiddleware` | Reads `SignatureOptions` from `AppConfig` by key.                                   |
| `RequireSignatureOptions`          | type      | `{ policy?: string }`                                                                                       | Default `REQUIRE_SIGNATURE_POLICY`.                                                 |
| `SignatureOptions`                 | type      | `{ header, secret, algorithm, digest }`                                                                     | Stored in `AppConfig`, not passed inline.                                           |
| `REQUIRE_SIGNATURE_POLICY`         | constant  | `'request.signature.valid'`                                                                                 | —                                                                                   |
| `SignaturePolicyContext<TOptions>` | interface | `{ rawBody: BinaryLike; getHeader: (name) => string; options: TOptions }`                                   | The policy context for a signature scheme.                                          |
| `DefaultSignaturePolicy`           | class     | `extends Policy<SignaturePolicyContext>`                                                                    | HMAC over `rawBody`, compared with `timingSafeEqual`. Denies `'invalid_signature'`. |

### Body parsing

| Export                                 | Kind           | Shape                                                                  | Notes                                |
| -------------------------------------- | -------------- | ---------------------------------------------------------------------- | ------------------------------------ |
| `ServerKitParser`                      | abstract class | The parser base                                                        | —                                    |
| `ServerKitParserResult`                | type           | Parser output                                                          | —                                    |
| `ServerKitParserMapping`               | type           | `{ parser: Constructor<ServerKitParser>; options?: { id, instance } }` | —                                    |
| `ServerKitParserMappings`              | class          | `extends Map<string, ServerKitParser>`                                 | DI token.                            |
| `ServerKitBodyParser`                  | class          | Dispatches to the mapped parser                                        | —                                    |
| `defaultParserMappings`                | constant       | `Record<string, ServerKitParserMapping>`                               | Table below. Extend by spreading.    |
| `JsonParser` / `JsonParserOptions`     | class          | —                                                                      | Options carry the `bigIntReviver`.   |
| `TextParser` / `TextParserOptions`     | class          | —                                                                      | —                                    |
| `FormParser` / `FormParserOptions`     | class          | —                                                                      | Uses `qs`.                           |
| `MultipartParser`                      | class          | —                                                                      | Wraps `@maroonedsoftware/multipart`. |
| `BinaryParser` / `BinaryParserOptions` | class          | —                                                                      | —                                    |

| MIME subtype                                                                         | Parser                        |
| ------------------------------------------------------------------------------------ | ----------------------------- |
| `json`, `application/*+json`                                                         | `JsonParser` (bigint reviver) |
| `urlencoded`                                                                         | `FormParser`                  |
| `text`                                                                               | `TextParser`                  |
| `multipart`                                                                          | `MultipartParser`             |
| `application/octet-stream`, `application/pdf`, `application/zip`, `application/gzip` | `BinaryParser`                |

### SSE

| Export                                     | Kind                  | Shape                                                              | Notes                                                                  |
| ------------------------------------------ | --------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `openSseStream`                            | function              | `(ctx: SseContext, options?: SseStreamOptions) => SseStream`       | Takes over the raw socket (`ctx.respond = false`).                     |
| `SseStream`                                | interface             | `write`, `event`, `comment`, `onClose`, `close`, `readonly closed` | Writes after close are no-ops. `onClose` after close runs immediately. |
| `SseStreamOptions`                         | interface             | `{ heartbeatMs?, maxBufferedBytes?, headers?, signal? }`           | Pass `builder.lifecycleSignal` as `signal` — see Gotchas.              |
| `SseContext`                               | interface             | `{ status, respond?, res: SseResponse }`                           | Small structural type so handlers are testable with a fake `res`.      |
| `SseResponse`                              | interface             | Raw response sink, including `writableLength`                      | —                                                                      |
| `SseFrame` / `frameEvent` / `frameComment` | interface / functions | Frame shape and serialisers                                        | —                                                                      |
| `resolveLastEventId`                       | function              | `(header: string, queryLastEventId: unknown) => number`            | —                                                                      |
| `firstQueryValue`                          | function              | `(value: unknown) => string \| undefined`                          | —                                                                      |
| `DEFAULT_SSE_HEARTBEAT_MS`                 | constant              | `15_000`                                                           | `0` disables.                                                          |
| `DEFAULT_SSE_MAX_BUFFERED_BYTES`           | constant              | `1_000_000`                                                        | Past this, the client is dropped and reconnects with `Last-Event-ID`.  |

### Lifecycle

| Export                      | Kind      | Shape                                                                                                                                                            | Notes                                             |
| --------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `ServerKitModule<ConfigT>`  | interface | `{ name?, setup?, start?, ready?, shutdown? }`                                                                                                                   | See the lifecycle table in the root AGENTS.md.    |
| `ServerKitServerBuilder`    | class     | `setup(config, logger, modules, parserMappings?)`, `setupMiddleware(fn?)`, `setupRoutes(routers)`, `start(port, options?)`, `whenReady()`, `get lifecycleSignal` | Sets Luxon's default zone to UTC on construction. |
| `ServerKitStartOptions`     | interface | `{ shutdownGraceMs?: number }`                                                                                                                                   | Default 10 s. `0` force-closes immediately.       |
| `DEFAULT_SHUTDOWN_GRACE_MS` | constant  | `10_000`                                                                                                                                                         | —                                                 |

### `./serverfeed`

| Export                      | Kind      | Shape                                                                            | Notes                                                                 |
| --------------------------- | --------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `serverFeedRouter`          | function  | `(options?: ServerFeedRouterOptions) => ServerKitRouterType`                     | Mounts `GET /server/feed` (configurable), guarded by `requirePolicy`. |
| `ServerFeedRouterOptions`   | interface | `extends SseStreamOptions` with `{ path?, policy?, resolveFeed? }`               | `resolveFeed` defaults to `ctx.container.get(ServerFeed)`.            |
| `handleServerFeed`          | function  | `(ctx: ServerFeedContext, feed: ServerFeed, options?: SseStreamOptions) => void` | For mounting the handler on your own route.                           |
| `ServerFeedContext`         | interface | `extends SseContext`                                                             | —                                                                     |
| `serverFeedFilterFromQuery` | function  | `(query: Record<string, unknown>) => ServerFeedFilter`                           | —                                                                     |

**Not exported:** `fakeSecurityMiddleware` (`src/middleware/server/fake.security.middleware.ts`) is
absent from the barrel despite having tests. It injects a fixed `Authorization` header and logs a
warning. Treat it as internal, and do not add it to the barrel — the export boundary is what stops
it reaching production.

## Canonical usage

```typescript
import { ServerKitServerBuilder, ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';

const router = ServerKitRouter();

router.post('/api/invoices', bodyParserMiddleware(['application/json']), requirePolicy(), async ctx => {
  const body = await parseAndValidate(ctx.parsedBody, CreateInvoice);
  ctx.body = await ctx.container.get(InvoiceService).create(body);
});

const builder = new ServerKitServerBuilder();
await builder.setup(config, logger, modules);
builder.setupMiddleware().setupRoutes([router]);
await builder.start(3000, { shutdownGraceMs: 15_000 });
```

Building the stack by hand — this order is not stylistic:

```typescript
app.use(errorMiddleware()); // first: catches everything downstream
app.use(serverKitContextMiddleware(container)); // second: creates ctx.container / ctx.logger
app.use(corsMiddleware({ origin: [/\.example\.com$/] }));
app.use(authenticationMiddleware());
app.use(router.routes()).use(router.allowedMethods()); // last
```

SSE, wired to the lifecycle signal so shutdown can drain it:

```typescript
import { serverFeedRouter } from '@maroonedsoftware/koa/serverfeed';

builder.setupRoutes([serverFeedRouter({ signal: builder.lifecycleSignal })]);
```

See [.claude/skills/koa-route](../../.claude/skills/koa-route) and
[.claude/skills/koa-middleware](../../.claude/skills/koa-middleware).

## Rules for generated code

- `errorMiddleware()` first, `serverKitContextMiddleware(container)` second, `router.routes()` last.
  Prefer `serverKitDefaultMiddleware` over assembling by hand.
- Type handlers against `ServerKitContext`, not Koa's `Context`.
- Read the parsed request body from **`ctx.parsedBody`**. `ctx.body` is Koa's _response_ body.
- `ctx.parsedBody` is `unknown`. Narrow it with `parseAndValidate` from `@maroonedsoftware/zod`
  rather than casting.
- Resolve request-scoped services from `ctx.container`, never from the root container, and use
  `ctx.logger` rather than an injected `Logger` so request and correlation IDs travel with the line.
- Add `bodyParserMiddleware([...])` per route with the content types that route accepts. It is not
  global.
- Guard authenticated routes with `requirePolicy()`. Use `{ policy: false }` for
  authenticated-but-ungated routes and a named policy for step-up or AAL2 gates.
- Store `SignatureOptions` in `AppConfig` and pass `requireSignature` the config key. Never inline a
  secret.
- Always pass `signal: builder.lifecycleSignal` to `openSseStream` and `serverFeedRouter`.
- Register cleanup with `stream.onClose(...)` for every timer and subscription an SSE handler
  creates.
- Import `serverFeedRouter` from `@maroonedsoftware/koa/serverfeed`, never from the root.
- Put slow start-up work in a module's `ready` hook, not `start`.
- Extend `defaultParserMappings` by spreading rather than mutating it.

## Gotchas

- **Middleware registered before `serverKitContextMiddleware` has no `ctx.container` and no
  `ctx.logger`.** It fails at runtime, not at compile time, because the type says the fields are
  there. This is the single most common way to break a ServerKit app.
- **`errorMiddleware` renders three different bodies.** An `HttpError` yields its status, message,
  and `details` plus its headers; a bare `ServerkitError` yields a **500 with its `details`**; a
  plain `Error` yields a generic 500 with **no** details. Throwing `new Error('...')` silently
  drops everything the client could have been told.
- **A 404 is synthesised after `next()`** when the status is 404 and no body was set, and emits
  `warn` rather than `error`. A route that sets a 404 status _and_ a body passes through untouched.
- **The rate limiter is inserted only when a `RateLimiter` is registered.** No registration means no
  rate limiting, silently. There is no warning.
- **`ServerKitRouterType` is the erased `Router<unknown, unknown>`** and is invariant in its context
  type, so passing a concrete router to `setupRoutes` needs a cast. `serverFeedRouter` does that
  cast internally; you will need it too.
- **`openSseStream` sets `ctx.respond = false` and takes over the socket.** After calling it, do not
  set `ctx.body` or `ctx.status` — Koa is no longer managing the response. It owns the socket
  specifically so a client disconnect does not log `ERR_STREAM_PREMATURE_CLOSE` on every teardown.
- **An SSE stream never ends on its own.** Without `options.signal`, every connected client holds
  `server.close()` open until the shutdown grace period force-closes it. Pass
  `builder.lifecycleSignal`.
- **A slow SSE client is dropped, not throttled.** Past `maxBufferedBytes` (1 MB) the stream closes
  and the client reconnects with `Last-Event-ID`. A single failed write is normal backpressure and
  is tolerated.
- **`ServerKitServerBuilder` throws until `setup` has run.** It installs a no-op container
  placeholder at construction, so calling `setupMiddleware` first fails.
- **The constructor sets `Settings.defaultZone = 'utc'` globally.** Constructing a builder changes
  Luxon's behaviour process-wide, including in tests that never start a server.
- **`ready` hook failures are logged and do not block**, while `start` hook failures do. Work placed
  in `start` delays boot for every module after it.
- **`requirePolicy()` defaults to `'auth.session.mfa.satisfied'`.** Calling it bare on a route that
  only needs authentication rejects sessions that have not stepped up. Pass `{ policy: false }`.
- **`DefaultSignaturePolicy` denies on a length mismatch too**, which is how a missing or empty
  header is handled without tripping `timingSafeEqual`'s equal-length requirement. Diagnostics
  (header, algorithm, digest, both signatures) go to `internalDetails`; the secret never does.
- **`ServerKitContext` is declaration-merged** (interface + abstract class) so one symbol is both
  the type and the DI token, like `Logger` and `JobContext`. Do not split it.

## Working inside this package

```
src/
  index.ts                     Root barrel
  serverkit.context.ts         ServerKitContext (interface + token)
  serverkit.middleware.ts      ServerKitMiddleware, ServerKitRouterMiddleware
  serverkit.router.ts          ServerKitRouter, ServerKitRouterType
  serverkit.module.ts          ServerKitModule
  serverkit.server.builder.ts  ServerKitServerBuilder, start options, graceful shutdown
  serverkit.bodyparser.ts      ServerKitBodyParser, ServerKitParserMappings
  middleware/
    server/                    error, serverkit.context, cors, rate.limiter, authentication,
                               serverkit.default.middlewares, fake.security (NOT exported)
    router/                    body.parser, require.policy, require.signature
  policies/                    request.signature.valid.policy
  parsers/                     serverkit.parser, json, text, form, multipart, binary,
                               serverkit.default.parsers
  sse/                         sse.frame, sse.request, sse.stream
  serverfeed.ts                Subpath entry for ./serverfeed
  serverfeed/server.feed.stream.ts  serverFeedRouter, handleServerFeed, filter-from-query
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **Nothing reachable from `src/index.ts` may import `@maroonedsoftware/serverfeed`.** It is an
  optional peer reachable only through `./serverfeed`.
- The canonical middleware order in `serverKitDefaultMiddleware` is a correctness contract, not a
  default. Reordering it breaks every app that uses it.
- `errorMiddleware`'s three-way rendering split (`HttpError` / `ServerkitError` / `Error`) is a
  data-exposure boundary shared with `@maroonedsoftware/policies`' `assert`. Changing which payload
  reaches the client is a security change.
- `fakeSecurityMiddleware` must stay out of the barrel.
- The SSE stream must keep owning the socket and swallowing disconnect teardown; handing Koa a
  stream body reintroduces `ERR_STREAM_PREMATURE_CLOSE` on every client disconnect.
- Signature comparison must stay constant-time (`timingSafeEqual`), and the secret must never reach
  `details` or the response.
- Graceful shutdown must remain bounded: long-lived connections are force-closed once the grace
  period elapses so `close()` can never hang.

User-visible changes need a changeset in `.changeset/`.
