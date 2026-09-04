# AGENTS.md — @maroonedsoftware/mcp

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

Serve the Model Context Protocol from a ServerKit app. The official
`@modelcontextprotocol/sdk` low-level `Server` is wrapped behind a DI-registered dispatcher: tools
and resources are `@Injectable()` handlers registered in maps at bootstrap, request-scoped state
travels through `AsyncLocalStorage` rather than closures, and bearer auth is expressed as an
`AuthenticationHandler`, so an MCP caller arrives at a tool as an ordinary `AuthenticationSession`.
Stateless is the default; stateful (`Mcp-Session-Id`, SSE, server-initiated messages) is opt-in.

Reach for this to expose your app's capabilities to an MCP client. Do **not** expect an MCP
_client_ — this is server-side only. And note that the bundled auth is scaffold-grade: a single
static shared token.

## Install

```bash
pnpm add @maroonedsoftware/mcp @modelcontextprotocol/sdk
```

Runtime dependencies: `@maroonedsoftware/authentication`, `@maroonedsoftware/errors`,
`@maroonedsoftware/logger`, `@maroonedsoftware/policies`, `@modelcontextprotocol/sdk`,
`injectkit`. Optional peer: `@maroonedsoftware/cache` (for externalising session/event state in
stateful mode).

## Position in the graph

- **Depends on:** `authentication`, `errors`, `logger`, `policies`. `cache` is an **optional** peer.
- **Depended on by:** nothing internal. It is a leaf that applications wire up directly.
- **Subpath exports:** none. `exports` maps only `.` and `./package.json`.

**Deliberately not a dependency: `koa` or `fastify`.** The package is transport-neutral. Your route
extracts the request, builds an `McpRequestContext`, and calls the dispatcher. Authentication needs
no adapter either: `McpAuthenticationHandler` implements the `authentication` package's
`AuthenticationHandler`, which both adapters already drive through `AuthenticationSchemeHandler`.

The deprecated `McpAuthPolicyContext` is _structurally_ compatible with koa's
`SignaturePolicyContext<McpAuthOptions>`, which is what let koa's `requireSignature` drive MCP bearer
auth without either package depending on the other. That trick is no longer the recommended path —
it reads the `Authorization` header, which the authentication stack deletes.

## API surface

### Config and errors

| Export                           | Kind                       | Shape                                                                                           | Notes                                                                                              |
| -------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `McpConfig`                      | interface + abstract class | `{ serverName, version, sessionMode?, bearerToken?, allowUnauthenticated?, subject?, requestTimeoutMs? }` | Declaration-merged so one symbol is type and DI token. `requestTimeoutMs` aborts `context.signal`; `subject` names the MCP client on the session. |
| `McpSessionMode`                 | type                       | `'stateless' \| 'stateful'`                                                                     | Default `'stateless'`.                                                                             |
| `MCP_DEFAULT_REQUEST_TIMEOUT_MS` | constant                   | `30_000`                                                                                        | Applied when `requestTimeoutMs` is unset.                                                          |
| `McpError`                       | class                      | `extends ServerkitError`                                                                        | —                                                                                                  |
| `IsMcpError`                     | type guard                 | `(error: unknown) => error is McpError`                                                         | —                                                                                                  |

### Auth

| Export                            | Kind      | Shape                                                                                                         | Notes                                                                                                                            |
| --------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `McpAuthenticationHandler`        | class     | `@Injectable() implements AuthenticationHandler`                                                              | **How you authenticate.** Resolves the shared token into an `AuthenticationSession`. Register under `bearer`.                     |
| `MCP_DEFAULT_SUBJECT`             | constant  | `'mcp'`                                                                                                       | `session.subject` when `McpConfig.subject` is unset.                                                                              |
| `compareMcpToken`                 | function  | `(provided: string, expected: string) => boolean`                                                             | Constant-time, with the length guard. Blank either side is `false`.                                                               |
| `isBlankBearerToken`              | function  | `(bearerToken: string \| undefined) => boolean`                                                                | `true` only when a token was configured **and** is blank. `undefined` needs `allowUnauthenticated`; blank is refused either way.  |
| `requireMcpPolicy`                | function  | `(context, policies: PolicyService, options?: { policy?: string \| false }) => Promise<AuthenticationSession>` | **The per-tool guard.** Session plus optional policy. `policy` defaults to `false` — see Gotchas.                                 |
| `RequireMcpPolicyOptions`         | interface | `{ policy?: string \| false }`                                                                                | Pass `MFA_SATISFIED_POLICY` to mirror the HTTP `requirePolicy()` default.                                                         |
| `requireMcpAuthenticationSession` | function  | `(context: McpAuthenticatedContext) => AuthenticationSession`                                                 | Narrows a handler context or **throws** 401. Treats a missing session as unauthenticated. `requireMcpPolicy` wraps it.            |
| `McpAuthenticatedContext`         | type      | `{ authenticationSession?: AuthenticationSession }`                                                           | Structural, so a tool, resource, or request context all satisfy it.                                                               |
| `McpAuthFailureReason`            | type      | `'missing_token' \| 'invalid_token'`                                                                           | Lands in `internalDetails.reason`.                                                                                                |

#### Deprecated: the header-reading path

All still functional, all removed in a later major. They re-read the `Authorization` header, which
`authenticationPlugin` / `authenticationMiddleware` delete once `AuthenticationSchemeHandler` has
resolved it — so this path only works on a server with no authentication stack, and it carries a
second identity model (`context.auth`) alongside `context.authenticationSession`.

| Export                     | Kind      | Shape                                                                                                      | Replacement                                       |
| -------------------------- | --------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `assertMcpAuth`            | function  | `(container, getHeader) => Promise<McpAuthInfo \| undefined>`                                               | `McpAuthenticationHandler` + `requirePolicy`      |
| `McpAuthPolicy`            | class     | `extends Policy<McpAuthPolicyContext>`                                                                     | `McpAuthenticationHandler`                        |
| `MCP_AUTH_POLICY`          | constant  | `'mcp.auth.valid'`                                                                                         | —                                                 |
| `McpAuthPolicyContext`     | interface | `{ getHeader: (name) => string; options: McpAuthOptions; rawBody?: unknown; onResolved?: (auth) => void }` | —                                                 |
| `verifyMcpBearer`          | function  | `(input: VerifyMcpBearerInput) => McpAuthInfo`                                                             | `compareMcpToken` + `isBlankBearerToken`          |
| `VerifyMcpBearerInput`     | type      | `{ authorization: string \| undefined; expectedToken: string }`                                             | —                                                 |
| `McpAuthInfo`              | interface | `{ token: string; subject?: string; scopes?: string[] }`                                                   | `AuthenticationSession`                           |
| `McpAuthOptions`           | type      | `Pick<McpConfig, 'bearerToken' \| 'allowUnauthenticated'>`                                                  | `McpConfig`                                       |
| `MCP_AUTHORIZATION_HEADER` | constant  | `'Authorization'`                                                                                          | —                                                 |
| `McpContextBase.auth`      | field     | `McpAuthInfo \| undefined`                                                                                  | `McpContextBase.authenticationSession`            |

### Request context

All three context types extend one base, so a new request-scoped value is declared once.

| Export                         | Kind      | Shape                                                                                                      | Notes                                                           |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `McpContextBase`               | interface | `{ requestId: string; logger: Logger; auth?: McpAuthInfo; authenticationSession?: AuthenticationSession }` | The shared half of all three contexts. Add new fields **here**. |
| `McpRequestContext`            | interface | `McpContextBase & { forTool(name, signal?), forResource(uri, signal?) }`                                   | Transport-neutral — no koa or injectkit types.                  |
| `McpToolContext`               | interface | `McpContextBase & { toolName, signal? }`                                                                   | What a tool handler receives.                                   |
| `McpResourceContext`           | interface | `McpContextBase & { uri, signal? }`                                                                        | What a resource handler receives.                               |
| `createMcpRequestContext`      | function  | `(input: CreateMcpRequestContextInput) => McpRequestContext`                                               | Build it from `ctx` in your route.                              |
| `CreateMcpRequestContextInput` | type      | Alias for `McpContextBase`                                                                                 | The factory takes exactly the shared fields.                    |
| `mcpContext`                   | constant  | `AsyncLocalStorage<McpRequestContext>`                                                                     | Set by the dispatcher. **Handlers never read it directly.**     |

### Handlers

| Export                  | Kind      | Shape                                                                                                                    | Notes                                                   |
| ----------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `McpToolHandler`        | interface | `{ readonly definition: Tool; handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> }` | `definition` must be a stable value.                    |
| `McpToolHandlerMap`     | class     | `@Injectable() extends Map<string, McpToolHandler>`                                                                      | Keyed by `definition.name`.                             |
| `McpResourceHandler`    | interface | `{ readonly definition: Resource; read(uri: string, context: McpResourceContext): Promise<ReadResourceResult> }`         | —                                                       |
| `McpResourceHandlerMap` | class     | `@Injectable() extends Map<string, McpResourceHandler>`                                                                  | Keyed by `definition.uri`. **Exact-URI matching only.** |

### Server, transport, dispatch

| Export                | Kind  | Shape                                                                                                   | Notes                                                                                             |
| --------------------- | ----- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `McpServerFactory`    | class | `@Injectable()`. `create(): Server`                                                                     | Memoizes `tools/list` and `resources/list` at construction; handlers are stable instance methods. |
| `KoaMcpTransport`     | class | `implements Transport`. `receive(message)`, `response()`                                                | Single-exchange transport for **stateless** mode only.                                            |
| `McpSessionRegistry`  | class | `@Injectable()`. `handle(exchange, context)`                                                            | In-memory `Map` of `Mcp-Session-Id` → `{ server, transport }`.                                    |
| `McpStatefulExchange` | type  | `{ req: IncomingMessage; res: ServerResponse; body: unknown; sessionId? }`                              | —                                                                                                 |
| `McpDispatcher`       | class | `@Injectable()`. `get sessionMode`, `dispatch(message, context)`, `dispatchStateful(exchange, context)` | The single entry point.                                                                           |

`dispatch` returns `undefined` for a notification (no `id`) — the route acks with 202.

## Canonical usage

```typescript
import { Injectable } from 'injectkit';
import {
  McpConfig,
  McpDispatcher,
  McpToolHandlerMap,
  McpResourceHandlerMap,
  McpAuthenticationHandler,
  createMcpRequestContext,
  requireMcpPolicy,
  type McpToolHandler,
  type McpToolContext,
} from '@maroonedsoftware/mcp';
import {
  AuthenticationHandlerChain,
  AuthenticationHandlerMap,
  AuthenticationSchemeHandler,
  ChainedAuthenticationHandler,
  JwtAuthenticationHandler,
} from '@maroonedsoftware/authentication';

@Injectable()
class SearchDocsTool implements McpToolHandler {
  readonly definition = {
    name: 'search_docs',
    description: 'Search the documentation',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  } as const;

  constructor(private readonly docs: DocsService) {}

  async handle(args: Record<string, unknown>, context: McpToolContext) {
    const { query } = await parseAndValidate(args, SearchArgs); // validate against inputSchema
    context.logger.info('search_docs', { requestId: context.requestId });
    return { content: [{ type: 'text' as const, text: await this.docs.search(query, { signal: context.signal }) }] };
  }
}

// Composition root
registry.register(SearchDocsTool).useClass(SearchDocsTool).asSingleton();

registry.register(McpToolHandlerMap).useMap(McpToolHandlerMap).set('search_docs', SearchDocsTool);
registry.register(McpResourceHandlerMap).useMap(McpResourceHandlerMap);
registry.register(McpConfig).useValue(appConfig.getAs<McpConfig>('mcp'));

// Auth: the MCP token is a session source, so it goes through the scheme handler
// like any other credential. Chain it with the JWT handler — `bearer` holds one.
registry.register(McpAuthenticationHandler).useClass(McpAuthenticationHandler).asSingleton();
registry.register(JwtAuthenticationHandler).useClass(JwtAuthenticationHandler).asSingleton();
registry.register(AuthenticationHandlerChain).useArray(AuthenticationHandlerChain).push(McpAuthenticationHandler).push(JwtAuthenticationHandler);
registry.register(ChainedAuthenticationHandler).useClass(ChainedAuthenticationHandler).asSingleton();
registry.register(AuthenticationHandlerMap).useMap(AuthenticationHandlerMap).set('bearer', ChainedAuthenticationHandler);
registry.register(AuthenticationSchemeHandler).useClass(AuthenticationSchemeHandler);
```

The route — one shape, both modes. Authentication has already happened by the time it runs:
`authenticationMiddleware` (koa) / `authenticationPlugin` (fastify) resolved the header into
`authenticationSession`, so the route only guards and dispatches. `requirePolicy({ policy: false })`
is the guard: it rejects an unauthenticated caller with 401 but does not apply the MFA policy, which
the scaffold session cannot satisfy.

**Koa.** `bodyParserMiddleware` must run first: it is what populates `ctx.parsedBody` and
`ctx.rawBody`. Koa's own `ctx.request.body` is never populated by ServerKit, so reading it yields
`undefined`.

```typescript
router.post('/mcp', bodyParserMiddleware(['application/json']), requirePolicy({ policy: false }), async ctx => {
  const dispatcher = ctx.container.get(McpDispatcher);
  const context = createMcpRequestContext({ requestId: ctx.requestId, logger: ctx.logger, authenticationSession: ctx.authenticationSession });

  if (dispatcher.sessionMode === 'stateful') {
    ctx.respond = false; // hand the raw response stream to the SDK transport
    await dispatcher.dispatchStateful({ req: ctx.req, res: ctx.res, body: ctx.parsedBody, sessionId: ctx.get('mcp-session-id') }, context);
    return;
  }

  const response = await dispatcher.dispatch(ctx.parsedBody as JSONRPCMessage, context);
  if (response) ctx.body = response;
  else ctx.status = 202; // notification — nothing to return
});
```

**Fastify.** Accepted content types go in the route's `config.body`, guards in `preHandler`, and the
parsed payload is on `request.body`.

```typescript
app.post('/mcp', { config: { body: ['application/json'] }, preHandler: [requirePolicy({ policy: false })] }, async (request, reply) => {
  const dispatcher = request.container.get(McpDispatcher);
  const context = createMcpRequestContext({
    requestId: request.requestId,
    logger: request.logger,
    authenticationSession: request.authenticationSession,
  });

  if (dispatcher.sessionMode === 'stateful') {
    reply.hijack(); // the SDK transport owns the response
    await dispatcher.dispatchStateful({ req: request.raw, res: reply.raw, body: request.body, sessionId: request.headers['mcp-session-id'] as string }, context);
    return;
  }

  const response = await dispatcher.dispatch(request.body as JSONRPCMessage, context);
  if (response) return response;
  reply.status(202);
  return undefined;
});
```

## Rules for generated code

- **Validate `args` against your own `definition.inputSchema`.** The dispatcher passes
  `params.arguments` through raw; the SDK does not validate it for you. Use
  `parseAndValidate` from `@maroonedsoftware/zod`.
- Keep `definition` a stable value on the handler. `tools/list` and `resources/list` are memoized at
  bootstrap, so a definition computed per access is silently ignored after the first read.
- Register handlers in the maps at bootstrap under `definition.name` / `definition.uri`. The maps
  are frozen from the factory's point of view once it is constructed.
- Build the `McpRequestContext` per request from `ctx.requestId`, `ctx.logger`, and
  `ctx.authenticationSession`. Never reuse one across requests. On Fastify the same three values
  come from `request.requestId`, `request.logger`, and `request.authenticationSession`.
- Use `context.logger` and `context.requestId` inside handlers, not an injected `Logger`.
- Forward `context.signal` to any async work so client cancellation and the request timeout can
  actually stop it. The signal is the SDK's per-request abort signal combined with
  `McpConfig.requestTimeoutMs`.
- Throw to surface a JSON-RPC error; set `isError: true` on a `CallToolResult` for a tool-level
  failure the **model** should see and can react to. They are different channels.
- Set `ctx.respond = false` before `dispatchStateful` and do not touch `ctx.body` afterwards — the
  SDK transport owns the response.
- Read `dispatcher.sessionMode` rather than duplicating the config check in the route.
- Never set `allowUnauthenticated` in a config that ships. It exists so that running with no
  authentication is a statement in config rather than an omission, which makes it reviewable. In
  handler form it means the handler authenticates nobody, so the `/mcp` route must also be mounted
  **without** `requirePolicy` — otherwise every request is a 401.
- Register `McpAuthenticationHandler` under `bearer`, through `ChainedAuthenticationHandler` when
  the server also serves JWT bearer traffic. Do not reach for the deprecated `assertMcpAuth` /
  `MCP_AUTH_POLICY` path in new code; it cannot see the header behind the auth stack.
- Replace `McpAuthenticationHandler` before production. Write another `AuthenticationHandler` that
  validates a real OAuth access token and put it in the chain; nothing downstream of
  `authenticationSession` changes.
- **A tool whose operation declares a policy must enforce it itself.** The guard on the `/mcp`
  route gates the mount, not the individual tool, so every exposed tool is otherwise callable by
  anyone who clears that one guard. Inject `PolicyService` through the constructor and open
  `handle` with `const session = await requireMcpPolicy(context, this.policies, { policy: policyName });`
  — the same rule the HTTP route evaluates. Omit `policy` to require only a valid session.
- For relationship-based authorization, `@maroonedsoftware/permissions` composes the same way:
  inject the `AuthorizationModel` and `PermissionsTupleRepository` (both singletons), take the
  object id from the tool's own `args`, and use `session.subject` as the subject. Prefer wrapping
  the `check()` call in a policy so HTTP and MCP share one rule.
- Never read `mcpContext` directly from a handler. Use the `McpToolContext` / `McpResourceContext`
  you were handed.

## Gotchas

- **The authentication stack deletes the `Authorization` header.** `authenticationPlugin` (fastify)
  and `authenticationMiddleware` (koa) read it, hand it to `AuthenticationSchemeHandler`, and delete
  it from both header views before any route runs — on every route, whitelisted or not. Anything
  re-reading it later sees nothing. This is the single reason the deprecated `assertMcpAuth` /
  `requireSignature` path denies every request behind the default stack, and the reason MCP auth is
  an `AuthenticationHandler` now.
- **The scaffold session has no factors, so `requirePolicy()`'s default rejects it.** A shared token
  satisfies no `AuthenticationFactorMethod`, so `factors` is honestly empty and
  `DefaultMfaSatisfiedPolicy` denies. Mount `/mcp` with `requirePolicy({ policy: false })`, and note
  `requireMcpPolicy` defaults to `policy: false` for the same reason — the opposite of the HTTP
  default. Pass `MFA_SATISFIED_POLICY` explicitly only where callers hold real user sessions.
- **The bundled auth is scaffold-grade, but it is not open by omission.** `McpAuthenticationHandler`
  throws unless the config says something definite: a `bearerToken` to enforce, or
  `allowUnauthenticated: true` to run with none. A missing key and a blank token both fail closed,
  because neither is a decision anyone can be shown to have made. Only `allowUnauthenticated` opts
  in, and it is a name you can grep production config for. A real deployment is still an OAuth 2.0
  resource server validating a JWT; this only stops the accident.
- **The check runs on the first request, not at boot.** The package has no module lifecycle, and
  validating earlier would wrongly refuse to boot a server that swapped in its own handler and
  legitimately has no `bearerToken`. So a misconfigured server starts and fails the first MCP call
  with a 500.
- **Unauthenticated mode resolves nobody, deliberately.** The opted-in branch returns the sentinel
  rather than minting a session. Presenting a token to an endpoint that has none configured proves
  nothing, so a session built from it would hand every caller an authenticated identity. That does
  mean the route cannot carry a session guard in this mode.
- **The session token is not the bearer token.** `McpAuthenticationHandler` mints a fresh random
  `sessionToken` per request, so the credential cannot leak through anything that logs a session,
  and nothing mistakes it for a stored, revocable session key. It references nothing.
- **Chain order does not affect correctness, only work.** Handlers decline by returning the
  sentinel, so a JWT-bearing request reaching `McpAuthenticationHandler` first simply falls through.
  Put the cheaper or more common one first. This is also why a mismatch logs at `debug`: behind a
  chain it is the ordinary case.
- **Stateful mode requires session affinity.** `McpSessionRegistry` is an in-memory `Map`, so a
  session lives in one process. Behind a load balancer you need sticky routing, or externalised
  session/event state (the SDK's `eventStore`, backed by the optional `@maroonedsoftware/cache`
  peer). Nothing enforces this.
- **`dispatchStateful` in stateless mode only logs a warning** and proceeds. It does not throw, so a
  mis-wired route degrades quietly.
- **`Server` is `@deprecated` in favour of `McpServer`, and staying on it is deliberate.** The SDK's
  note reads "Use `McpServer` instead for the high-level API. Only use `Server` for advanced use
  cases." `McpServer` is a wrapper that holds a `Server` (exposed as `.server`), not a replacement,
  and this package sits on the advanced side of that line. What it gives up by staying low-level:
  automatic input/output validation (documented as the handler's job on `McpToolHandler.handle`),
  `structuredContent` / `outputSchema` handling, prompts and `completion/complete` (not exposed by
  this package at all), and `listChanged` notifications (moot, the handler maps are frozen at
  bootstrap). `@typescript-eslint/no-deprecated` is not enabled in the shared ESLint config, so the
  deprecated import does not fail `build:ci`. Three reasons not to switch:
  1. `McpToolHandler.definition` is the SDK's `Tool` type, so `inputSchema` is JSON Schema.
     `McpServer.registerTool` accepts only zod v3/v4 (`ZodRawShapeCompat | AnySchema`), so switching
     would put zod in the public handler contract and add a zod dependency to this package.
  2. The SDK server is connection-scoped, so `McpServerFactory.create()` runs per request in
     stateless mode. It currently costs a shell plus four `setRequestHandler` calls with both list
     payloads memoized at construction; `McpServer` would cost one `registerTool` /
     `registerResource` per handler per connection and rebuild the lists from zod on every
     `tools/list`.
  3. `McpServer` wants a closure per registered tool, which is exactly what the `AsyncLocalStorage`
     bullet below says not to do.
- **The SDK `Server` is connection-scoped and cannot be a singleton.** It stores its transport and
  per-connection `initialize` state. `McpServerFactory.create()` makes a fresh thin shell per
  connection — do not "optimise" it into a shared instance.
- **`AsyncLocalStorage` is what makes concurrency safe here.** The factory's request handlers are
  stable instance methods that read `mcpContext`, so one set of functions serves every concurrent
  request without capturing any of them. Replacing them with per-request closures would undo the
  design.
- **The request timeout aborts the signal; it does not abandon the handler.** `requestTimeoutMs`
  fires `context.signal`, and nothing races the handler's promise. A handler that ignores the
  signal runs to completion and its result is still returned. Cancellation is cooperative by
  design — the alternative leaks work that keeps running with nobody waiting on it.
- **Closing the connection aborts in-flight signals.** The SDK aborts every outstanding request
  signal on `Server.close()`, which the stateless dispatcher calls right after producing a
  response. Sample `signal.aborted` inside a handler, not after `dispatch` resolves.
- **Resources are matched by exact URI.** `McpResourceHandlerMap` is a plain `Map.get`. Templated
  resources (`resources/templates`) need the factory extended to match against a template set.
- **`dispatch` returns `undefined` for notifications.** Setting `ctx.body = undefined` yields a 404
  from `errorMiddleware`, not a 202. Branch explicitly.
- **A stateful request with no session that is not an `initialize` gets a raw 400** written directly
  to `res` with JSON-RPC error `-32000`, bypassing `errorMiddleware` entirely.
- **`context.auth` (deprecated) is only populated by `assertMcpAuth`.** A route gated with
  `requireSignature` never passes `onResolved`, so the identity is verified and discarded, and
  behind the authentication stack neither can read the header at all. Read
  `context.authenticationSession` instead.
- **An error thrown from a handler becomes a JSON-RPC error on a 200 response.** That covers
  `requireMcpPolicy`'s 401 and `PolicyService.assert`'s 403: the status code and the
  `WWW-Authenticate` header never reach the wire, because the response is an MCP payload, not an
  HTTP error. That is the correct channel for a tool-level failure, but do not expect a client to
  drive re-auth from it. Gate the transport itself on the route for that.
- **The shared token identifies the client, not a user.** `McpAuthenticationHandler` resolves one
  subject (`McpConfig.subject`, default `'mcp'`) for everyone holding the token. Per-tool policies
  run, but they are deciding what that one client may do. For per-user authorization, authenticate
  MCP callers with a subject-resolving handler (JWT) instead.
- **`context.authenticationSession` is the ServerKit auth session, not the MCP transport session.**
  Two unrelated things share the word: `Mcp-Session-Id`, `McpSessionRegistry`, and `sessionMode`
  are the protocol's connection session; `authenticationSession` is who the caller is. A stateful
  MCP session is not evidence of authentication, and a request carrying a session token is not a
  stateful MCP session.
- **`McpConfig` is declaration-merged** (interface + abstract class), like `Logger` and
  `ServerKitContext`. Do not split it.

## Working inside this package

```
src/
  index.ts                  Barrel
  mcp.config.ts             McpConfig (interface + token), McpSessionMode,
                            MCP_DEFAULT_REQUEST_TIMEOUT_MS
  mcp.error.ts              McpError, IsMcpError
  mcp.auth.ts               compareMcpToken, isBlankBearerToken, verifyMcpBearer,
                            McpAuthInfo, McpAuthOptions, header constant
  mcp.authentication.handler.ts
                            McpAuthenticationHandler, MCP_DEFAULT_SUBJECT
  mcp.auth.policy.ts        MCP_AUTH_POLICY, McpAuthPolicy, McpAuthPolicyContext
  mcp.auth.assert.ts        assertMcpAuth
  mcp.request.context.ts    McpContextBase, McpRequestContext, McpToolContext,
                            McpResourceContext, mcpContext (ALS), createMcpRequestContext
  mcp.authentication.session.ts
                            requireMcpAuthenticationSession, McpAuthenticatedContext
  mcp.require.policy.ts     requireMcpPolicy, RequireMcpPolicyOptions
  mcp.tool.handler.ts       McpToolHandler, McpToolHandlerMap
  mcp.resource.handler.ts   McpResourceHandler, McpResourceHandlerMap
  mcp.server.factory.ts     McpServerFactory — memoized lists, stable handlers
  mcp.transport.ts          KoaMcpTransport — single-exchange, stateless only
  mcp.session.registry.ts   McpSessionRegistry, McpStatefulExchange
  mcp.dispatcher.ts         McpDispatcher
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **No dependency on `@maroonedsoftware/koa` or `@maroonedsoftware/fastify`.** The
  transport-neutral `McpRequestContext` exists to keep it that way, as did the structural
  `McpAuthPolicyContext` before it was deprecated. `KoaMcpTransport` is named for its use case, not
  for an import. `McpAuthenticationHandler` reaches both adapters through `authentication`, which is
  a layer below either.
- Request-scoped state flows through `AsyncLocalStorage`, never through closures captured per
  request. This is the concurrency-safety invariant.
- A new request-scoped value is declared on `McpContextBase` and spread into the derived contexts
  by `createMcpRequestContext`. Do not add a field to `McpToolContext` or `McpResourceContext`
  directly unless it is genuinely per-invocation, like `toolName`, `uri`, and `signal`.
- `tools/list` and `resources/list` stay memoized at factory construction; the handler maps are
  bootstrap-frozen.
- Bearer comparison stays constant-time, with the length guard that covers an empty or mismatched
  token without tripping `timingSafeEqual`.
- Adding stateful mode was additive and must stay that way — the stateless path shares the same
  factory, handler maps, request context, and auth.
- `@maroonedsoftware/cache` stays an optional peer; nothing in `src/` may import it unconditionally.

User-visible changes need a changeset in `.changeset/`.
