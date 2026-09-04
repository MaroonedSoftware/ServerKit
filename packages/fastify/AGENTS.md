# AGENTS.md — @maroonedsoftware/fastify

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

The Fastify HTTP layer, the sibling of `@maroonedsoftware/koa`. `ServerKitServerBuilder` wires an
InjectKit container, body parsers, hooks, and routers, then runs the shared module lifecycle
around a Fastify instance with graceful shutdown. The request context lives on `FastifyRequest`
itself (`request.container`, `request.logger`, `request.rawBody`, ...), with `ServerKitContext`
as the DI token for the live request. Do not reach for this package to add Fastify to an
existing Koa app; pick one adapter per server.

## Install

```bash
pnpm add @maroonedsoftware/fastify fastify @fastify/cors
```

Required peers: `fastify` (^5), `@fastify/cors` (^11). Optional peers: `@maroonedsoftware/serverfeed`
unlocks the `./serverfeed` subpath; `@maroonedsoftware/zod`, `zod`, and `fast-json-stringify`
unlock `./zod` (the last only for response serialization).

Runtime dependencies: `appconfig`, `authentication`, `errors`, `logger`, `policies`, `servercore`,
plus `injectkit` and `type-is`.

## Position in the graph

- **Depends on:** `servercore` (the framework-neutral core), `appconfig`, `authentication`,
  `errors`, `logger`, `policies`.
- **Depended on by:** nothing internal.
- **Subpath exports:** `./serverfeed` — the SSE adapter for `@maroonedsoftware/serverfeed`, an
  **optional** peer. `./zod` — Fastify's schema compilers backed by `@maroonedsoftware/zod`, also
  optional peers. Both are subpaths so nothing reachable from the root barrel imports either.

## API surface

### Context, plugin, router types

| Export                      | Kind                       | Shape                                                                                                                                                                                                         | Notes                                                                                             |
| --------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `ServerKitContext`          | interface + abstract class | `extends FastifyRequest`; the module augmentation adds `container`, `logger`, `loggerName`, `userAgent`, `ipAddress`, `correlationId`, `requestId`, `rawBody`, `authenticationSession`, `reply` | Declaration-merged so one symbol is both the type and a DI token. The request **is** the context. |
| `ServerKitPlugin`           | type                       | `FastifyPluginAsync`                                                                                                                                                                                          | A server-stack plugin, registered in order by `setupPlugins`. Applies to the root instance.       |
| `serverKitPlugin`           | function                   | `(name: string, plugin: (app: FastifyInstance) => void \| Promise<unknown>) => ServerKitPlugin`                                                                                                               | Wraps a plugin with `fastify-plugin` so its hooks escape encapsulation. Use it for custom steps.  |
| `createFastifyLogger`       | function                   | `(logger: Logger, bindings?: Record<string, unknown>) => FastifyBaseLogger`                                                                                                                                    | Bridges Fastify's logging to a ServerKit `Logger`. `fatal` maps to `error`. Installed by default. |
| `ServerKitRoutes`           | type                       | `FastifyPluginAsync`                                                                                                                                                                                          | A route plugin. Encapsulated, so its own hooks apply only to its routes.                          |
| `ServerKitRouteMount`       | interface                  | `{ plugin: ServerKitRoutes; prefix?: string }`                                                                                                                                                                | A route plugin plus the path prefix to mount it under.                                            |
| `FastifyContextConfig.body` | augmentation               | `body?: string[]`                                                                                                                                                                                             | Route `config` field: the content types this route accepts a body for. Read by `bodyParserPlugin`. |

### Server plugins

| Export                              | Kind      | Shape                                                                                          | Notes                                                                                                                                                                                                      |
| ----------------------------------- | --------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `errorPlugin`                   | function  | `(container: Container) => ServerKitPlugin`                                                | **Register first.** Installs `setErrorHandler` (via `renderError`) and `setNotFoundHandler`; logs through the request logger, falling back to the root `Logger`.                                            |
| `normalizeFastifyError`             | function  | `(error: unknown) => unknown`                                                                  | Maps a Fastify-raised 4xx to `httpError(status).withDetails({ reason })`; everything else passes through.                                                                                                  |
| `serverKitContextPlugin`        | function  | `(container: Container) => ServerKitPlugin`                                                | **Register second.** Declares the request decorators and installs the `onRequest` hook that creates the scope. The scope is disposed when `reply.raw` closes, so a hijacked SSE reply outlives the handler. |
| `bodyParserPlugin`              | function  | `() => ServerKitPlugin`                                                                    | Replaces Fastify's parsers with ServerKit's, gated by each route's `config.body`. Parses into `request.body`, raw bytes on `request.rawBody`. 400 / 411 / 413 / 415 / 422. Register after the context plugin. |
| `corsPlugin`                    | function  | `(options?: CorsOptions) => ServerKitPlugin`                                               | Registers `@fastify/cors` from inside the plugin, so its hook keeps stack order. Options pass through untouched; `methods` defaults wider. Throws when `credentials` is paired with a `'*'` origin.                   |
| `CorsOptions`                       | type      | `FastifyCorsOptions`                                                                           | `@fastify/cors`'s own options, unchanged. Alias only, so the plugin adds no matching of its own.                                                                                                            |
| `rateLimiterPlugin`             | function  | `(rateLimiter: RateLimiter) => ServerKitPlugin`                                            | Per-IP `onRequest` hook; 429 when exceeded.                                                                                                                                                                |
| `authenticationPlugin`          | function  | `(options?: AuthenticationPluginOptions) => ServerKitPlugin`                           | `onRequest` hook resolving `Authorization` via `AuthenticationSchemeHandler` into `request.authenticationSession`; strips the header from `headers`, `raw.headers`, and `raw.rawHeaders`; `anonymousPaths` skips the handler. |
| `AuthenticationPluginOptions`   | interface | `{ anonymousPaths?: (string \| RegExp)[] }`                                                    | Strings match the path exactly; RegExp is the escape hatch.                                                                                                                                                |
| `serverKitDefaultPlugins`        | function  | `(container: Container, options?: ServerKitDefaultPluginsOptions) => ServerKitPlugin[]` | error → context → body parser → rate limiter (**only if a `RateLimiter` is registered**) → cors (`exposedHeaders: ['WWW-Authenticate']`) → authentication.                                                |
| `ServerKitDefaultPluginsOptions` | interface | `{ authentication?: AuthenticationPluginOptions }`                                         | Forwarded to `authenticationPlugin`.                                                                                                                                                                   |

### Route guards

| Export                    | Kind      | Shape                                                                                                       | Notes                                                                                                                             |
| ------------------------- | --------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `requirePolicy`           | function  | `(options?: RequirePolicyOptions) => preHandlerAsyncHookHandler`                                            | 401 on an invalid session; then asserts a policy (403 on deny). Default `MFA_SATISFIED_POLICY`; `false` skips the policy. Also usable in `onRequest`. |
| `RequirePolicyOptions`    | interface | `{ policy?: string \| false }`                                                                              | —                                                                                                                                 |
| `requireSignature`        | function  | `<TOptions = SignatureOptions>(optionsKey, options?: RequireSignatureOptions) => preHandlerAsyncHookHandler` | Reads `SignatureOptions` from `AppConfig` by key; asserts with 401. Needs `request.rawBody`, so the route's `config.body` must allow the payload. |
| `RequireSignatureOptions` | type      | `{ policy?: string }`                                                                                       | Default `REQUIRE_SIGNATURE_POLICY`.                                                                                               |

### SSE

| Export         | Kind     | Shape                                                            | Notes                                                                                     |
| -------------- | -------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `openSseReply` | function | `(reply: FastifyReply, options?: SseStreamOptions) => SseStream` | Hijacks the reply, then `openSseStream` owns `reply.raw`. Pass `builder.lifecycleSignal`. |

The stream and frame types (`SseStream`, `SseStreamOptions`, `SseFrame`, `frameEvent`, ...) are re-exported from `servercore`.

### `./serverfeed`

| Export                      | Kind      | Shape                                                              | Notes                                                                 |
| --------------------------- | --------- | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `serverFeedRoutes`          | function  | `(options?: ServerFeedRoutesOptions) => FastifyPluginAsync`        | Mounts `GET /server/feed` (configurable), guarded by `requirePolicy` in `onRequest`. |
| `ServerFeedRoutesOptions`   | interface | `extends SseStreamOptions` with `{ path?, policy?, resolveFeed? }` | `resolveFeed` defaults to `request.container.get(ServerFeed)`.        |
| `handleServerFeed`          | function  | re-export                                                          | From `@maroonedsoftware/servercore/serverfeed`.                       |
| `ServerFeedContext`         | interface | re-export                                                          | From `@maroonedsoftware/servercore/serverfeed`.                       |
| `serverFeedFilterFromQuery` | function  | re-export                                                          | From `@maroonedsoftware/servercore/serverfeed`.                       |

### `./zod`

| Export                  | Kind      | Shape                                                                  | Notes                                                                                                          |
| ----------------------- | --------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `zodPlugin`             | function  | `(options?: ZodPluginOptions) => ServerKitPlugin`                      | Installs both compilers. Register after `errorPlugin`.                                                          |
| `ZodPluginOptions`      | interface | `{ serializer?: CompileSerializerOptions }`                            | Forwarded to `compileSerializer` for every response schema.                                                     |
| `zodValidatorCompiler`  | function  | `() => FastifySchemaCompiler<ZodType>`                                 | `safeParse`; the parsed **output** replaces the input. Failure is an `HttpError` with `zodErrorDetails`.        |
| `zodSerializerCompiler` | function  | `(options?: CompileSerializerOptions) => FastifySerializerCompiler<ZodType>` | Compiles each `response[status]` with `fast-json-stringify` at boot.                                        |
| `ZodTypeProvider`       | interface | `extends FastifyTypeProvider`                                          | `validator` is `z.output`, `serializer` is `z.input`. Apply with `app.withTypeProvider<ZodTypeProvider>()`.     |

### Lifecycle

| Export                      | Kind      | Shape                                                                                                                                                                                                                         | Notes                                                                                                                             |
| --------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `ServerKitServerBuilder`    | class     | `constructor(options?: ServerKitFastifyOptions)`, `setup(config, logger, modules, parserMappings?)`, `setupPlugins(fn?)`, `setupRoutes(routes)`, `start(port, options?)`, `whenReady()`, `get lifecycleSignal`, `get app` | Extends `ServerKitServerBuilderBase` from `servercore`. Removes Fastify's parsers and installs a no-op catch-all at construction. |
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

Building the stack by hand — this order is not stylistic:

```typescript
builder.setupPlugins(container => [
  errorPlugin(container), // first: setErrorHandler / setNotFoundHandler
  serverKitContextPlugin(container), // second: creates request.container / request.logger
  app => app.addHook('onRequest', async request => request.logger.info('hello')),
]);
```

There is no `.claude/skills/` example for this package yet. Routes are plain Fastify plugins, so
follow the snippets here rather than translating the Koa skills, which describe a different model.

## Rules for generated code

- `errorPlugin(container)` first, `serverKitContextPlugin(container)` second. Prefer
  `serverKitDefaultPlugins` over assembling by hand, and wrap a custom step with `serverKitPlugin`
  so its hooks are not encapsulated.
- Type handlers as `(request: ServerKitContext, reply: FastifyReply)`; the request is the context.
- Declare the content types a route accepts in its route `config.body`, e.g.
  `{ config: { body: ['application/json'] } }`. A route without it rejects any body with 400.
- Read the parsed body from **`request.body`**, as in any Fastify app. Narrow it with
  `parseAndValidate` from `@maroonedsoftware/zod`. The raw bytes are on `request.rawBody`.
- Resolve request-scoped services from `request.container`, never from the root container, and
  log through `request.logger`.
- Guard authenticated routes with `requirePolicy()`. Use `{ policy: false }` for
  authenticated-but-ungated routes and a named policy for step-up or AAL2 gates.
- Store `SignatureOptions` in `AppConfig` and pass `requireSignature` the config key on a route
  whose `config.body` allows the payload, so `request.rawBody` exists. Never inline a secret.
- Return the response body from a handler, or `return reply.send(...)`; a handler that does
  neither leaves the request hanging. Fastify serializes a returned object as JSON.
- Write routes as Fastify plugins (`async app => { app.get(...) }`) and pass them to
  `setupRoutes`, mounting under a prefix with `{ plugin, prefix }`. Use `builder.app` only for
  third-party Fastify plugins.
- Put guards in a route's `preHandler` array, in order. Use `onRequest` instead when the request
  must be rejected before its body is read.
- Always pass `signal: builder.lifecycleSignal` to `openSseReply` and `serverFeedRoutes`, and
  register cleanup with `stream.onClose(...)` for every timer and subscription an SSE handler
  creates. Never `send` on a reply after `openSseReply`.
- Import `serverFeedRoutes` from `@maroonedsoftware/fastify/serverfeed`, and the zod compilers
  from `@maroonedsoftware/fastify/zod`, never from the root.
- With `zodPlugin`, declare route schemas as Zod schemas and type the instance with
  `withTypeProvider<ZodTypeProvider>()` rather than casting `request.body`. A route with a
  `schema.body` still needs its `config.body` content types.
- Put slow start-up work in a module's `ready` hook, not `start`.

## Gotchas

- **Fastify runs the request pipeline in fixed phases**: `onRequest` → parsing → `preValidation`
  → `preHandler` → handler. ServerKit's server plugins install `onRequest` hooks and its route
  guards are `preHandler` hooks, so a guard can never run before a server plugin. A hook
  registered on `builder.app` after `setupPlugins` still runs after the context hook.
- **A route without `config.body` rejects every body with 400**, including a route added directly
  on `builder.app`. Declaring a `schema.body` without it fails the request with a 500 naming the
  mistake, rather than an opaque 400.
- **Fastify's `bodyLimit` is only a `Content-Length` pre-check here** (a 413). ServerKit's parsers
  own the stream, so the enforced ceiling while reading is the parser's own option
  (`JsonParserOptions.limit`, default 1mb).
- **`GET`, `HEAD`, and `TRACE` never carry a parsed body.** Fastify does not parse them, so
  `config.body` on such a route cannot be satisfied and no 411 is raised; a body sent to one is
  still a 400.
- **A `preParsing` hook that replaces the payload stream is not honoured.** `ServerKitBodyParser`
  dispatches on the request headers and reads `request.raw` itself.
- **Omitting `bodyParserPlugin` from a custom stack leaves Fastify's own parsers active**, so
  `request.body` is parsed by Fastify with no route allow-list and no ServerKit status contract.
- **A chunked body without `Content-Length` counts as "no body"** for the 411 check, the same rule
  the Koa adapter applies.
- **`errorPlugin` renders three different bodies**, the same security boundary as Koa's: an
  `HttpError` yields its status, message, details, and headers; a bare `ServerkitError` a 500
  **with** details; a plain `Error` a generic 500 with none. A Fastify-raised 4xx becomes an
  `HttpError` whose only detail is `reason: error.message`.
- **`request.requestId` is Fastify's `request.id`**, resolved from `X-Request-Id` by the builder's
  `genReqId`. A custom `genReqId` in `fastify` options therefore changes both, and the echoed
  `x-request-id` response header. `correlationId` is still read straight from its own header.
- **Fastify's logging is bridged to the ServerKit `Logger`** and its per-request lines are
  silenced. Passing `fastify.logger` or `fastify.loggerInstance` opts out of the bridge entirely.
- **`ServerKitContext` is a module augmentation of `FastifyRequest`.** Importing this package
  adds the ServerKit fields to every `FastifyRequest` type in the consumer's program.
- **`setup` registers `ServerKitContext` as a scoped placeholder** so services can inject it;
  resolving it outside a request scope throws, and a singleton that depends on it fails
  validation at `setup`. Inject it only into scoped or transient services.
- **The scoped container is disposed on `reply.raw` `close`, not `onResponse`.** Resolving from
  `request.container` after the response has closed throws. Resolve before responding.
- **Behind a proxy, set `fastify: { trustProxy: true }`.** `request.ipAddress` and the rate
  limiter's bucket key are both Fastify's `request.ip`, which is the socket address unless
  `trustProxy` is set. Behind a load balancer that means every client shares one bucket. It is off
  by default on purpose: trusting `X-Forwarded-For` when nothing strips it lets any caller spoof
  its address and evade rate limiting, so enable it only when a proxy you control sets the header.
- **`corsPlugin` passes `origin` to `@fastify/cors` unchanged**, so its semantics apply: a fixed
  string is sent verbatim on every response, while an array or RegExp reflects the caller's origin
  only when it matches. With no `origin` the header is a literal `*`.
- **`host` defaults to `'::'`**, not Fastify's `localhost`. On a host without IPv6 pass
  `{ host: '0.0.0.0' }`.
- **`start()` resolves after the `start` hooks** and rejects if one throws, leaving the server
  listening for the caller to close.
- **The default stack resolves `AuthenticationSchemeHandler` on every non-anonymous request.**
  A server built with `setupPlugins()` and no scheme handler registered answers 500. Register
  one, or list the route under `anonymousPaths`.
- **The rate limiter is inserted only when a `RateLimiter` is registered.** No registration means
  no rate limiting, silently.
- **`requirePolicy()` defaults to `'auth.session.mfa.satisfied'`.** Pass `{ policy: false }` for
  session-only routes. The name is `MFA_SATISFIED_POLICY`, exported from
  `@maroonedsoftware/authentication`; reference it instead of the literal when code off the route
  path has to mirror this default.
- **`authenticationPlugin` removes the credential from every view of the request** once the scheme
  handler has read it — `request.headers`, `request.raw.headers`, and `request.raw.rawHeaders`,
  which Node fills separately at parse time and does not keep in sync (hence
  `stripRawAuthorizationHeader` from `servercore`). This happens on every route, including anonymous
  ones, so it cannot be captured by logging. It also means nothing downstream can re-read the
  credential: a `preHandler` or route that needs it must instead be an `AuthenticationHandler`
  registered for its scheme (chain it with `ChainedAuthenticationHandler` when the scheme is already
  taken). The deprecated `assertMcpAuth` in `@maroonedsoftware/mcp` is the cautionary case.
- **`corsPlugin` can be applied once per server only.** `@fastify/cors` decorates the request,
  so a second application throws on the duplicate decorator.
- **An SSE stream flushes its headers on the first write, not when it opens.** A client sees no
  response until an event, a comment, or the heartbeat is written; `serverFeedRoutes` with no
  backlog and `heartbeatMs: 0` is silent until the first live event.
- **An SSE stream never ends on its own.** Without `options.signal`, every connected client holds
  `server.close()` open until the grace period force-closes it.
- **The zod validator is synchronous**, as Fastify requires. A schema with async refinements or
  transforms cannot be a route schema; validate those in the handler with `parseAndValidate`.
- **The zod serializer does not validate.** A handler returning something the response schema does
  not describe has unknown properties dropped silently. A schema JSON Schema cannot express
  (a transform, `z.custom`, `z.date`, `z.bigint`) fails at boot, from `ready()`, not per request.
- **Fastify auto-registers `HEAD` for every `GET`.** Declaring an explicit `HEAD` route on the
  same path throws at registration; pass `exposeHeadRoute: false` on the `GET` if you need your own.

## Working inside this package

```
src/
  index.ts                     Root barrel (plus named re-exports from servercore)
  serverkit.context.ts         FastifyRequest augmentation, ServerKitContext (interface + token)
  serverkit.plugin.ts          ServerKitPlugin, serverKitPlugin (fastify-plugin wrapper)
  logger/fastify.logger.ts     createFastifyLogger (Logger to FastifyBaseLogger bridge)
  serverkit.server.builder.ts  ServerKitServerBuilder, ServerKitFastifyOptions, ServerKitRoutes
  request/request.accessors.ts Internal header/path helpers (not exported)
  hooks/                       require.policy, require.signature (route guards)
  sse/sse.reply.ts             openSseReply
  serverfeed.ts                Subpath entry for ./serverfeed
  serverfeed/server.feed.routes.ts  serverFeedRoutes
  zod.ts                       Subpath entry for ./zod
  zod/                         zod.plugin, zod.validator.compiler, zod.serializer.compiler,
                               zod.type.provider
  plugins/                     error (+ normalizeFastifyError), serverkit.context, body.parser, cors,
                               rate.limiter, authentication, serverkit.default.plugins
```

Tests are in `tests/`, mirroring `src/`; `tests/test.app.ts` builds a server for `app.inject()`.

Invariants a change must not break:

- The canonical order in `serverKitDefaultPlugins` is a correctness contract; plugins load in
  registration order, so a step added out of order silently changes hook order.
- `errorPlugin` must keep calling `renderError`; the three-way rendering split is a security
  boundary. `normalizeFastifyError` must never forward anything but `reason` for a Fastify 4xx.
- `bodyParserPlugin` must keep Fastify's own parsers removed, or its catch-all reads a stream
  Fastify has already consumed.
- Scope disposal must stay on `reply.raw` `close`, or hijacked SSE replies lose their services.
- Graceful shutdown stays the shared base's; `listen` must honour the abort `signal`.
- **Nothing reachable from `src/index.ts` may import `@maroonedsoftware/serverfeed`,
  `@maroonedsoftware/zod`, `zod`, or `fast-json-stringify.`** They are optional peers reachable
  only through `./serverfeed` and `./zod`; the `build` script lists all three tsup entries. Check
  the built bundle and its chunks, not just the source.

User-visible changes need a changeset in `.changeset/`. A new export must also land in the
`README.md` feature list, the API surface table above, and (for a subpath) `package.json`
`exports` plus the tsup entry list in the `build` script.
