# AGENTS.md — @maroonedsoftware/fastify

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

The Fastify HTTP layer, the sibling of `@maroonedsoftware/koa`. `ServerKitServerBuilder` wires an
InjectKit container, body parsers, hooks, and routers, then runs the shared module lifecycle
around a Fastify instance with graceful shutdown. The request context lives on `FastifyRequest`
itself (`request.container`, `request.logger`, `request.parsedBody`, ...), with `ServerKitContext`
as the DI token for the live request. Do not reach for this package to add Fastify to an
existing Koa app; pick one adapter per server.

## Install

```bash
pnpm add @maroonedsoftware/fastify fastify @fastify/cors
```

Required peers: `fastify` (^5), `@fastify/cors` (^11).

Runtime dependencies: `appconfig`, `authentication`, `errors`, `logger`, `policies`, `servercore`,
plus `injectkit` and `type-is`.

## Position in the graph

- **Depends on:** `servercore` (the framework-neutral core), `appconfig`, `authentication`,
  `errors`, `logger`, `policies`.
- **Depended on by:** nothing internal.
- **Subpath exports:** none yet.

## API surface

### Context, router, middleware types

| Export                      | Kind                       | Shape                                                                                                                                                                                                         | Notes                                                                                             |
| --------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `ServerKitContext`          | interface + abstract class | `extends FastifyRequest`; the module augmentation adds `container`, `logger`, `loggerName`, `userAgent`, `ipAddress`, `correlationId`, `requestId`, `rawBody`, `parsedBody`, `authenticationSession`, `reply` | Declaration-merged so one symbol is both the type and a DI token. The request **is** the context. |
| `ServerKitMiddleware`       | type                       | `(app: FastifyInstance) => void`                                                                                                                                                                              | A server-level registration step, applied in order by `setupMiddleware`.                          |
| `ServerKitRouterMiddleware` | type                       | `(request: ServerKitContext, reply: FastifyReply) => Promise<void>`                                                                                                                                           | A route guard, run as a `preHandler`. Throw to reject.                                            |
| `ServerKitRouteHandler`     | type                       | `(request: ServerKitContext, reply: FastifyReply) => unknown`                                                                                                                                                 | Return a value to send it.                                                                        |
| `ServerKitRouter`           | function                   | `(options?: { prefix? }) => ServerKitRouterType`                                                                                                                                                              | Factory, not a class.                                                                             |
| `ServerKitRouterType`       | interface                  | `use(...guards)`, `get/post/put/patch/delete/head/options(path, ...guards, handler)`, `routes(): FastifyPluginAsync`, `readonly prefix?`                                                                      | `routes()` registers each route with `preHandler: [...routerGuards, ...routeGuards]`.             |
| `ServerKitRouteHandlers`    | type                       | `[...ServerKitRouterMiddleware[], ServerKitRouteHandler]`                                                                                                                                                     | —                                                                                                 |
| `sendJson`                  | function                   | `(reply: FastifyReply, serialized: string, status?: number) => void`                                                                                                                                          | Sets `application/json` explicitly (Fastify sends a string as `text/plain`).                      |
| `requestPath`               | function                   | `(request: FastifyRequest) => string`                                                                                                                                                                         | Koa's `ctx.path`.                                                                                 |
| `requestMediaType`          | function                   | `(request: FastifyRequest) => string`                                                                                                                                                                         | Koa's `ctx.request.type`.                                                                         |
| `requestBodyLength`         | function                   | `(request: FastifyRequest) => number`                                                                                                                                                                         | Koa's `ctx.request.length`, `0` when absent.                                                      |
| `requestHeader`             | function                   | `(request: FastifyRequest, name: string) => string`                                                                                                                                                           | Koa's `ctx.get`.                                                                                  |

### Server middleware

| Export                              | Kind      | Shape                                                                                          | Notes                                                                                                                                                                                                      |
| ----------------------------------- | --------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `errorMiddleware`                   | function  | `(container: Container) => ServerKitMiddleware`                                                | **Must be first.** Installs `setErrorHandler` (via `renderError`) and `setNotFoundHandler`; logs through the request logger, falling back to the root `Logger`.                                            |
| `normalizeFastifyError`             | function  | `(error: unknown) => unknown`                                                                  | Maps a Fastify-raised 4xx to `httpError(status).withDetails({ reason })`; everything else passes through.                                                                                                  |
| `serverKitContextMiddleware`        | function  | `(container: Container) => ServerKitMiddleware`                                                | **Must be second.** Declares the request decorators and installs the `onRequest` hook that creates the scope. The scope is disposed when `reply.raw` closes, so a hijacked SSE reply outlives the handler. |
| `corsMiddleware`                    | function  | `(options?: CorsOptions) => ServerKitMiddleware`                                               | `@fastify/cors`, applied synchronously so its hook keeps stack order. `origin` accepts `'*'`, a string, or a list of strings/RegExps.                                                                      |
| `CorsOptions`                       | interface | `Omit<FastifyCorsOptions, 'origin'> & { origin?: CorsOrigin }`                                 | —                                                                                                                                                                                                          |
| `rateLimiterMiddleware`             | function  | `(rateLimiter: RateLimiter) => ServerKitMiddleware`                                            | Per-IP `onRequest` hook; 429 when exceeded.                                                                                                                                                                |
| `authenticationMiddleware`          | function  | `(options?: AuthenticationMiddlewareOptions) => ServerKitMiddleware`                           | `onRequest` hook resolving `Authorization` via `AuthenticationSchemeHandler` into `request.authenticationSession`; strips the header; `anonymousPaths` skips the handler.                                  |
| `AuthenticationMiddlewareOptions`   | interface | `{ anonymousPaths?: (string \| RegExp)[] }`                                                    | Strings match the path exactly; RegExp is the escape hatch.                                                                                                                                                |
| `serverKitDefaultMiddleware`        | function  | `(container: Container, options?: ServerKitDefaultMiddlewareOptions) => ServerKitMiddleware[]` | error → context → rate limiter (**only if a `RateLimiter` is registered**) → cors (`exposedHeaders: ['WWW-Authenticate']`) → authentication.                                                               |
| `ServerKitDefaultMiddlewareOptions` | interface | `{ authentication?: AuthenticationMiddlewareOptions }`                                         | Forwarded to `authenticationMiddleware`.                                                                                                                                                                   |

### Router middleware

| Export                    | Kind      | Shape                                                                                                       | Notes                                                                                                                             |
| ------------------------- | --------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `bodyParserMiddleware`    | function  | `(contentTypes: string[]) => ServerKitRouterMiddleware`                                                     | Parses per `Content-Type` into `request.parsedBody` / `request.rawBody`. 400 / 411 / 415 / 422.                                   |
| `requirePolicy`           | function  | `(options?: RequirePolicyOptions) => ServerKitRouterMiddleware`                                             | 401 on an invalid session; then asserts a policy (403 on deny). Default `'auth.session.mfa.satisfied'`; `false` skips the policy. |
| `RequirePolicyOptions`    | interface | `{ policy?: string \| false }`                                                                              | —                                                                                                                                 |
| `requireSignature`        | function  | `<TOptions = SignatureOptions>(optionsKey, options?: RequireSignatureOptions) => ServerKitRouterMiddleware` | Reads `SignatureOptions` from `AppConfig` by key; asserts with 401. Needs `request.rawBody`, so `bodyParserMiddleware` first.     |
| `RequireSignatureOptions` | type      | `{ policy?: string }`                                                                                       | Default `REQUIRE_SIGNATURE_POLICY`.                                                                                               |

### Lifecycle

| Export                      | Kind      | Shape                                                                                                                                                                                                                         | Notes                                                                                                                             |
| --------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `ServerKitServerBuilder`    | class     | `constructor(options?: ServerKitFastifyOptions)`, `setup(config, logger, modules, parserMappings?)`, `setupMiddleware(fn?)`, `setupRoutes(routers)`, `start(port, options?)`, `whenReady()`, `get lifecycleSignal`, `get app` | Extends `ServerKitServerBuilderBase` from `servercore`. Removes Fastify's parsers and installs a no-op catch-all at construction. |
| `ServerKitFastifyOptions`   | interface | `{ host?: string; fastify?: FastifyServerOptions }`                                                                                                                                                                           | `host` defaults to `'::'` (all interfaces), not Fastify's `localhost`.                                                            |
| `ServerKitStartOptions`     | interface | `{ shutdownGraceMs?: number }`                                                                                                                                                                                                | Re-exported from `servercore`.                                                                                                    |
| `DEFAULT_SHUTDOWN_GRACE_MS` | constant  | `10_000`                                                                                                                                                                                                                      | Re-exported from `servercore`.                                                                                                    |

### Re-exported from `servercore`

`ServerKitModule`, `ServerKitParser`, `ServerKitParserResult`, `ServerKitBodyParser`,
`ServerKitParserMappings`, `ServerKitBodySource`, `ServerKitParserMapping`, `defaultParserMappings`,
`JsonParser` / `JsonParserOptions`, `TextParser` / `TextParserOptions`, `FormParser` /
`FormParserOptions`, `MultipartParser`, `BinaryParser` / `BinaryParserOptions`,
`REQUIRE_SIGNATURE_POLICY`, `DefaultSignaturePolicy`, `SignaturePolicyContext`, `SignatureOptions`,
`RateLimiter`, `openSseStream`, `SseStream`, `SseStreamOptions`, `SseContext`, `SseResponse`,
`SseFrame`, `frameEvent`, `frameComment`, `resolveLastEventId`, `firstQueryValue`,
`DEFAULT_SSE_HEARTBEAT_MS`, `DEFAULT_SSE_MAX_BUFFERED_BYTES`. Same set as `@maroonedsoftware/koa`.

## Canonical usage

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

Building the stack by hand — this order is not stylistic:

```typescript
builder.setupMiddleware(container => [
  errorMiddleware(container), // first: setErrorHandler / setNotFoundHandler
  serverKitContextMiddleware(container), // second: creates request.container / request.logger
  app => app.addHook('onRequest', async request => request.logger.info('hello')),
]);
```

## Rules for generated code

- `errorMiddleware(container)` first, `serverKitContextMiddleware(container)` second. Prefer
  `serverKitDefaultMiddleware` over assembling by hand.
- Type handlers as `(request: ServerKitContext, reply: FastifyReply)`; the request is the context.
- Read the parsed request body from **`request.parsedBody`**. Fastify's `request.body` is never
  populated by ServerKit. Narrow `parsedBody` with `parseAndValidate` from `@maroonedsoftware/zod`.
- Resolve request-scoped services from `request.container`, never from the root container, and
  log through `request.logger`.
- Add `bodyParserMiddleware([...])` per route with the content types that route accepts. It is
  not global.
- Guard authenticated routes with `requirePolicy()`. Use `{ policy: false }` for
  authenticated-but-ungated routes and a named policy for step-up or AAL2 gates.
- Store `SignatureOptions` in `AppConfig` and pass `requireSignature` the config key, after
  `bodyParserMiddleware` on the same route. Never inline a secret.
- Return the response body from a handler, or call `reply.send`; a handler that does neither
  leaves the request hanging.
- Use `ServerKitRouter` and `setupRoutes` for routes; use `builder.app` only for third-party
  Fastify plugins.
- Put slow start-up work in a module's `ready` hook, not `start`.

## Gotchas

- **Fastify runs the request pipeline in fixed phases**: `onRequest` → parsing → `preValidation`
  → `preHandler` → handler. ServerKit's server middleware are `onRequest` hooks and its route
  guards are `preHandler` hooks, so a guard can never run before a server middleware. A hook
  registered on `builder.app` after `setupMiddleware` still runs after the context hook.
- **`request.body` is always `undefined`.** The builder removes Fastify's parsers so the raw
  stream survives until `bodyParserMiddleware`. Fastify's `bodyLimit` therefore does nothing;
  parser options (`JsonParserOptions.limit`) are the limit.
- **A chunked body without `Content-Length` counts as "no body"** for the 411 check, exactly as
  Koa's `ctx.request.length` behaves.
- **`errorMiddleware` renders three different bodies**, the same security boundary as Koa's: an
  `HttpError` yields its status, message, details, and headers; a bare `ServerkitError` a 500
  **with** details; a plain `Error` a generic 500 with none. A Fastify-raised 4xx becomes an
  `HttpError` whose only detail is `reason: error.message`.
- **`ServerKitContext` is a module augmentation of `FastifyRequest`.** Importing this package
  adds the ServerKit fields to every `FastifyRequest` type in the consumer's program.
- **`setup` registers `ServerKitContext` as a scoped placeholder** so services can inject it;
  resolving it outside a request scope throws, and a singleton that depends on it fails
  validation at `setup`. Inject it only into scoped or transient services.
- **The scoped container is disposed on `reply.raw` `close`, not `onResponse`.** Resolving from
  `request.container` after the response has closed throws. Resolve before responding.
- **`host` defaults to `'::'`**, not Fastify's `localhost`. On a host without IPv6 pass
  `{ host: '0.0.0.0' }`.
- **`start()` resolves after the `start` hooks** and rejects if one throws, leaving the server
  listening for the caller to close.
- **The default stack resolves `AuthenticationSchemeHandler` on every non-anonymous request.**
  A server built with `setupMiddleware()` and no scheme handler registered answers 500. Register
  one, or list the route under `anonymousPaths`.
- **The rate limiter is inserted only when a `RateLimiter` is registered.** No registration means
  no rate limiting, silently.
- **`requirePolicy()` defaults to `'auth.session.mfa.satisfied'`.** Pass `{ policy: false }` for
  session-only routes.
- **`corsMiddleware` bypasses `register`** and applies `@fastify/cors` to the root instance
  synchronously, so it can be applied once per server only; a second application throws on the
  duplicate request decorator.
- **Fastify auto-registers `HEAD` for every `GET`.** Declaring an explicit `head()` on the same
  path throws at registration.

## Working inside this package

```
src/
  index.ts                     Root barrel (plus named re-exports from servercore)
  serverkit.context.ts         FastifyRequest augmentation, ServerKitContext (interface + token)
  serverkit.middleware.ts      ServerKitMiddleware, ServerKitRouterMiddleware, ServerKitRouteHandler
  serverkit.router.ts          ServerKitRouter, ServerKitRouterType
  serverkit.request.ts         requestPath, requestMediaType, requestBodyLength, requestHeader
  serverkit.server.builder.ts  ServerKitServerBuilder, ServerKitFastifyOptions
  send.json.ts                 sendJson
  middleware/
    server/                    error (+ normalizeFastifyError), serverkit.context, cors, rate.limiter,
                               authentication, serverkit.default.middlewares
    router/                    body.parser, require.policy, require.signature
```

Tests are in `tests/`, mirroring `src/`; `tests/test.app.ts` builds a server for `app.inject()`.

Invariants a change must not break:

- The canonical order in `serverKitDefaultMiddleware` is a correctness contract.
- `errorMiddleware` must keep calling `renderError`; the three-way rendering split is a security
  boundary. `normalizeFastifyError` must never forward anything but `reason` for a Fastify 4xx.
- The builder must keep Fastify's parsers removed and the `'*'` catch-all a no-op, or
  `bodyParserMiddleware` reads an already-consumed stream.
- Scope disposal must stay on `reply.raw` `close`, or hijacked SSE replies lose their services.
- Graceful shutdown stays the shared base's; `listen` must honour the abort `signal`.

User-visible changes need a changeset in `.changeset/`. A new export must also land in the
`README.md` feature list, the API surface table above, and (for a subpath) `package.json`
`exports` plus the tsup entry list in the `build` script.
