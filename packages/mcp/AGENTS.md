# AGENTS.md — @maroonedsoftware/mcp

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

Serve the Model Context Protocol from a ServerKit app. The official
`@modelcontextprotocol/sdk` `Server` is wrapped behind a DI-registered dispatcher: tools and
resources are `@Injectable()` handlers registered in maps at bootstrap, request-scoped state travels
through `AsyncLocalStorage` rather than closures, and bearer auth is expressed as a
`@maroonedsoftware/policies` policy. Stateless is the default; stateful (`Mcp-Session-Id`, SSE,
server-initiated messages) is opt-in.

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

**Deliberately not a dependency: `koa`.** The package is transport-neutral. Your route extracts the
request, builds an `McpRequestContext`, and calls the dispatcher. The auth policy context is
_structurally_ compatible with koa's `SignaturePolicyContext<McpAuthOptions>`, which is what lets
koa's `requireSignature` drive MCP bearer auth without either package depending on the other.

## API surface

### Config and errors

| Export                           | Kind                       | Shape                                                                    | Notes                                                                                              |
| -------------------------------- | -------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `McpConfig`                      | interface + abstract class | `{ serverName, version, sessionMode?, bearerToken?, requestTimeoutMs? }` | Declaration-merged so one symbol is type and DI token. `requestTimeoutMs` aborts `context.signal`. |
| `McpSessionMode`                 | type                       | `'stateless' \| 'stateful'`                                              | Default `'stateless'`.                                                                             |
| `MCP_DEFAULT_REQUEST_TIMEOUT_MS` | constant                   | `30_000`                                                                 | Applied when `requestTimeoutMs` is unset.                                                          |
| `McpError`                       | class                      | `extends ServerkitError`                                                 | —                                                                                                  |
| `IsMcpError`                     | type guard                 | `(error: unknown) => error is McpError`                                  | —                                                                                                  |

### Auth

| Export                            | Kind      | Shape                                                                         | Notes                                                                                     |
| --------------------------------- | --------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `verifyMcpBearer`                 | function  | `(input: VerifyMcpBearerInput) => McpAuthInfo`                                | Pure. Constant-time compare. **Throws** `McpError` on failure.                            |
| `VerifyMcpBearerInput`            | type      | `{ authorization: string \| undefined; expectedToken: string }`               | —                                                                                         |
| `McpAuthInfo`                     | interface | `{ token: string; subject?: string; scopes?: string[] }`                      | The scaffold fills only `token`.                                                          |
| `McpAuthFailureReason`            | type      | `'missing_token' \| 'invalid_token'`                                          | Lands in `internalDetails.reason`.                                                        |
| `McpAuthOptions`                  | type      | `Pick<McpConfig, 'bearerToken'>`                                              | Structural subset, so an `McpConfig` value satisfies it directly.                         |
| `MCP_AUTHORIZATION_HEADER`        | constant  | `'Authorization'`                                                             | —                                                                                         |
| `MCP_AUTH_POLICY`                 | constant  | `'mcp.auth.valid'`                                                            | The `PolicyRegistryMap` key.                                                              |
| `McpAuthPolicy`                   | class     | `extends Policy<McpAuthPolicyContext>`                                        | Policy form of the verifier — denies rather than throwing.                                |
| `McpAuthPolicyContext`            | interface | `{ getHeader: (name) => string; options: McpAuthOptions; rawBody?: unknown }` | `rawBody` is accepted and ignored, purely for koa structural compatibility.               |
| `requireMcpAuthenticationSession` | function  | `(context: McpAuthenticatedContext) => AuthenticationSession`                 | Narrows a handler context or **throws** 401. Treats a missing session as unauthenticated. |
| `McpAuthenticatedContext`         | type      | `{ authenticationSession?: AuthenticationSession }`                           | Structural, so a tool, resource, or request context all satisfy it.                       |

### Request context

| Export                         | Kind      | Shape                                                                                                      | Notes                                                       |
| ------------------------------ | --------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `McpRequestContext`            | interface | `{ requestId, logger, auth?, authenticationSession?, forTool(name, signal?), forResource(uri, signal?) }`  | Transport-neutral — no koa or injectkit types.              |
| `createMcpRequestContext`      | function  | `(input: CreateMcpRequestContextInput) => McpRequestContext`                                               | Build it from `ctx` in your route.                          |
| `CreateMcpRequestContextInput` | type      | `{ requestId: string; logger: Logger; auth?: McpAuthInfo; authenticationSession?: AuthenticationSession }` | —                                                           |
| `mcpContext`                   | constant  | `AsyncLocalStorage<McpRequestContext>`                                                                     | Set by the dispatcher. **Handlers never read it directly.** |
| `McpToolContext`               | interface | `{ requestId, logger, auth?, authenticationSession?, toolName, signal? }`                                  | What a tool handler receives.                               |
| `McpResourceContext`           | interface | `{ requestId, logger, auth?, authenticationSession?, uri, signal? }`                                       | What a resource handler receives.                           |

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
  McpAuthPolicy,
  MCP_AUTH_POLICY,
  createMcpRequestContext,
  type McpToolHandler,
  type McpToolContext,
  type McpAuthOptions,
} from '@maroonedsoftware/mcp';

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
policies.set(MCP_AUTH_POLICY, McpAuthPolicy);
```

The route — one shape, both modes. `bodyParserMiddleware` must run first: it is what populates `ctx.parsedBody` and `ctx.rawBody`. Koa's own `ctx.request.body` is never populated by ServerKit, so reading it yields `undefined`.

```typescript
router.post('/mcp', bodyParserMiddleware(['application/json']), requireSignature<McpAuthOptions>('mcp', { policy: MCP_AUTH_POLICY }), async ctx => {
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
- Replace `verifyMcpBearer` (or subclass `McpAuthPolicy` and re-register under `MCP_AUTH_POLICY`)
  before production. Keep the `(request) → McpAuthInfo | throw` shape so the wiring is unchanged.
- **A tool whose operation declares a policy must enforce it itself.** The guard on the `/mcp`
  route gates the mount, not the individual tool, so every exposed tool is otherwise callable by
  anyone who clears that one guard. Inject `PolicyService` through the constructor and open
  `handle` with `const session = requireMcpAuthenticationSession(context);` followed by
  `await this.policies.assert(policyName, { session });` — the same rule the HTTP route evaluates.
- For relationship-based authorization, `@maroonedsoftware/permissions` composes the same way:
  inject the `AuthorizationModel` and `PermissionsTupleRepository` (both singletons), take the
  object id from the tool's own `args`, and use `session.subject` as the subject. Prefer wrapping
  the `check()` call in a policy so HTTP and MCP share one rule.
- Never read `mcpContext` directly from a handler. Use the `McpToolContext` / `McpResourceContext`
  you were handed.

## Gotchas

- **The bundled auth is scaffold-grade, and it fails open.** `McpAuthPolicy` **allows** every
  request when `McpConfig.bearerToken` is unset, on the reasoning that an unset token means
  "development, intentionally open". Ship a config without a token and the endpoint is wide open
  with no warning. A real deployment is an OAuth 2.0 resource server validating a JWT.
- **Stateful mode requires session affinity.** `McpSessionRegistry` is an in-memory `Map`, so a
  session lives in one process. Behind a load balancer you need sticky routing, or externalised
  session/event state (the SDK's `eventStore`, backed by the optional `@maroonedsoftware/cache`
  peer). Nothing enforces this.
- **`dispatchStateful` in stateless mode only logs a warning** and proceeds. It does not throw, so a
  mis-wired route degrades quietly.
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
- **`McpAuthPolicyContext.rawBody` exists only for structural compatibility** with koa's
  `SignaturePolicyContext`. It is accepted and ignored. That is the trick that keeps this package
  free of a `koa` dependency.
- **`verifyMcpBearer` throws while `McpAuthPolicy` denies.** Same logic, two shapes. Pick the one
  that matches your call site.
- **An error thrown from a handler becomes a JSON-RPC error on a 200 response.** That covers
  `requireMcpAuthenticationSession`'s 401 and `PolicyService.assert`'s 403: the status code and the
  `WWW-Authenticate` header never reach the wire, because the response is an MCP payload, not an
  HTTP error. That is the correct channel for a tool-level failure, but do not expect a client to
  drive re-auth from it. Gate the transport itself on the route for that.
- **The bundled shared-token auth resolves no session, so per-tool policies cannot run behind it.**
  `McpAuthPolicy` proves the caller holds the configured token; it identifies nobody. Behind it
  `context.authenticationSession` is `undefined` and every policy check fails closed. A route that
  needs per-tool enforcement runs the real authentication stack with a subject-resolving scheme
  handler (JWT, for instance).
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
  mcp.auth.ts               verifyMcpBearer, McpAuthInfo, McpAuthOptions, header constant
  mcp.auth.policy.ts        MCP_AUTH_POLICY, McpAuthPolicy, McpAuthPolicyContext
  mcp.request.context.ts    McpRequestContext, mcpContext (ALS), createMcpRequestContext,
                            McpToolContext, McpResourceContext
  mcp.authentication.session.ts
                            requireMcpAuthenticationSession, McpAuthenticatedContext
  mcp.tool.handler.ts       McpToolHandler, McpToolHandlerMap
  mcp.resource.handler.ts   McpResourceHandler, McpResourceHandlerMap
  mcp.server.factory.ts     McpServerFactory — memoized lists, stable handlers
  mcp.transport.ts          KoaMcpTransport — single-exchange, stateless only
  mcp.session.registry.ts   McpSessionRegistry, McpStatefulExchange
  mcp.dispatcher.ts         McpDispatcher
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **No dependency on `@maroonedsoftware/koa`.** The structural `McpAuthPolicyContext` and the
  transport-neutral `McpRequestContext` exist to keep it that way. `KoaMcpTransport` is named for
  its use case, not for an import.
- Request-scoped state flows through `AsyncLocalStorage`, never through closures captured per
  request. This is the concurrency-safety invariant.
- `tools/list` and `resources/list` stay memoized at factory construction; the handler maps are
  bootstrap-frozen.
- Bearer comparison stays constant-time, with the length guard that covers an empty or mismatched
  token without tripping `timingSafeEqual`.
- Adding stateful mode was additive and must stay that way — the stateless path shares the same
  factory, handler maps, request context, and auth.
- `@maroonedsoftware/cache` stays an optional peer; nothing in `src/` may import it unconditionally.

User-visible changes need a changeset in `.changeset/`.
