# @maroonedsoftware/mcp

Transport-agnostic [Model Context Protocol](https://modelcontextprotocol.io) **server** support for ServerKit. It wraps the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) so it fits ServerKit's patterns instead of owning your stack:

- tools and resources are DI-registered `@Injectable()` handler maps (like the Discord/Slack dispatchers), not imperative `server.tool()` calls;
- the SDK's low-level `Server` stays the protocol engine (JSON-RPC framing, capability negotiation, `initialize`), while registration and transport are ServerKit-native seams;
- request context (request id, logger, auth subject, authentication session) is threaded to handlers via `AsyncLocalStorage`, so one set of handlers serves concurrent requests safely.

The package owns no HTTP routes — wire `McpDispatcher` from your own Koa (or Express/Fastify/Lambda) handler. It targets MCP over **Streamable HTTP**; stdio transport is out of scope.

## Installation

```bash
pnpm add @maroonedsoftware/mcp @modelcontextprotocol/sdk
```

## Exports

| Symbol                                          | Purpose                                                                                                                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `McpConfig`                                     | Abstract `@Injectable()` token; carries `serverName`, `version`, optional `sessionMode`, `bearerToken`, `allowUnauthenticated`, `requestTimeoutMs`. Consumer registers a concrete value. |
| `McpDispatcher`                                 | Entry point. `dispatch(message, context)` for stateless mode; `dispatchStateful(exchange, context)` for stateful. Selects the mode from `McpConfig.sessionMode`.                         |
| `McpServerFactory`                              | Builds SDK `Server` instances wired to the handler maps — memoizes the `tools/list` payload and uses stable, ALS-backed request handlers.                                                |
| `McpToolHandler` / `McpToolHandlerMap`          | One-method tool handler interface (`handle(args, context)`) + its `Map<toolName, handler>` DI token.                                                                                     |
| `McpResourceHandler` / `McpResourceHandlerMap`  | Resource handler interface (`read(uri, context)`) + its `Map<uri, handler>` DI token.                                                                                                    |
| `McpSessionRegistry`                            | Stateful-mode registry: one SDK `Server` + `StreamableHTTPServerTransport` per `Mcp-Session-Id`, reused across the session.                                                              |
| `KoaMcpTransport`                               | Minimal single-exchange `Transport` for stateless mode (one JSON-RPC message in, one response out).                                                                                      |
| `McpRequestContext` / `createMcpRequestContext` | Request-scoped context threaded to handlers (request id, logger, auth info, authentication session), plus the factory that builds one from your `ctx`.                                   |
| `verifyMcpBearer(input)`                        | Pure bearer-token verifier. Returns `McpAuthInfo` or throws `McpError`. **Scaffold-grade** — swap for OAuth resource-server JWT validation.                                              |
| `isBlankBearerToken(bearerToken)`               | Distinguishes an unset shared token from one configured as a blank string. Both fail closed; only the second is a misconfiguration.                                                      |
| `assertMcpAuth(container, getHeader)`           | Gates a request on `MCP_AUTH_POLICY` and returns the identity it resolved, for `context.auth`. Throws 401 on denial.                                                                     |
| `McpAuthPolicy`                                 | `@maroonedsoftware/policies` form of `verifyMcpBearer` (registered under `MCP_AUTH_POLICY`). Slots into koa's `requireSignature`.                                                        |
| `requireMcpAuthenticationSession(context)`      | Narrows a handler context to an authenticated `AuthenticationSession`, or throws 401. Use it before evaluating a policy in a tool.                                                       |
| `McpError` / `IsMcpError`                       | `ServerkitError` subclass for non-HTTP domain failures, plus its type guard.                                                                                                             |

## Configuration

The package does not read `AppConfig` itself — services take `McpConfig` directly via DI. Resolve it at bootstrap and register it:

```ts
import { AppConfigBuilder, AppConfigSourceJson } from '@maroonedsoftware/appconfig';
import { McpConfig } from '@maroonedsoftware/mcp';

const appConfig = await new AppConfigBuilder().addSource(new AppConfigSourceJson('./config.json')).build();

const mcpConfig = appConfig.getAs<McpConfig>('mcp');
registry.register(McpConfig).useValue(mcpConfig);
```

```jsonc
// config.json
{
  "mcp": {
    "serverName": "my-service",
    "version": "1.0.0",
    "sessionMode": "stateless", // optional; "stateless" (default) or "stateful"
    "bearerToken": "${env:MCP_BEARER_TOKEN}", // enables the bundled auth policy
    // "allowUnauthenticated": true,          // only in place of bearerToken, only in development
    "requestTimeoutMs": 30000, // optional
  },
}
```

| Field                  | Required | Used by                                                                                                                                                       |
| ---------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `serverName`           | yes      | Advertised to clients as `serverInfo.name` during `initialize`.                                                                                               |
| `version`              | yes      | Advertised as `serverInfo.version`.                                                                                                                           |
| `sessionMode`          | no       | `'stateless'` (default) or `'stateful'` — see [session modes](#session-modes).                                                                                |
| `bearerToken`          | no       | Shared token accepted by `McpAuthPolicy`. Unset requires `allowUnauthenticated`.                                                                              |
| `allowUnauthenticated` | no       | Run with no authentication, deliberately. Required when `bearerToken` is unset; ignored when it is set. Development only.                                     |
| `requestTimeoutMs`     | no       | Milliseconds after which `context.signal` aborts. Defaults to `MCP_DEFAULT_REQUEST_TIMEOUT_MS` (30s). Cooperative: forward the signal or the handler runs on. |

## Defining tools

A tool is an `@Injectable()` handler exposing its advertisement (`definition`) and a `handle(args, context)` method. Validate `args` against `definition.inputSchema` before use.

```ts
import { Injectable } from 'injectkit';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpToolHandler, McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';

@Injectable()
class SearchDocsTool implements McpToolHandler {
  readonly definition = {
    name: 'search_docs',
    description: 'Full-text search across the docs.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  } as const;

  async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
    context.logger.info('search_docs', { requestId: context.requestId });
    const hits = await search(String(args.query));
    return { content: [{ type: 'text', text: hits.join('\n') }] };
  }
}

// Bootstrap
registry.register(SearchDocsTool).useClass(SearchDocsTool).asSingleton();

registry.register(McpToolHandlerMap).useMap(McpToolHandlerMap).set('search_docs', SearchDocsTool);
registry.register(McpResourceHandlerMap).useMap(McpResourceHandlerMap); // empty is fine
```

Resources follow the same shape with `McpResourceHandler` (`read(uri, context)`), registered by URI in `McpResourceHandlerMap`. The dispatcher advertises only the capabilities backed by a non-empty map, so a tools-only server doesn't claim resource support.

## Serving MCP

You own the route. Add `bodyParserMiddleware(['application/json'])` first (ServerKit puts the parsed payload on `ctx.parsedBody`, never on koa's `ctx.request.body`), gate it with the auth policy, build an `McpRequestContext` from `ctx`, and dispatch. The mode is chosen from `McpConfig.sessionMode`. On Fastify the same three context values come from `request.requestId`, `request.logger`, and `request.authenticationSession`:

```ts
import { bodyParserMiddleware, requireSignature } from '@maroonedsoftware/koa';
import { McpDispatcher, createMcpRequestContext, MCP_AUTH_POLICY, type McpAuthOptions } from '@maroonedsoftware/mcp';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

router.post('/mcp', bodyParserMiddleware(['application/json']), requireSignature<McpAuthOptions>('mcp', { policy: MCP_AUTH_POLICY }), async ctx => {
  const dispatcher = ctx.container.get(McpDispatcher);
  const context = createMcpRequestContext({ requestId: ctx.requestId, logger: ctx.logger, authenticationSession: ctx.authenticationSession });
  // Add `auth` too when a handler needs it — see Authentication, below.

  if (dispatcher.sessionMode === 'stateful') {
    ctx.respond = false; // hand the raw response stream to the SDK transport (SSE)
    await dispatcher.dispatchStateful(
      { req: ctx.req, res: ctx.res, body: ctx.parsedBody, sessionId: ctx.get('mcp-session-id') || undefined },
      context,
    );
    return;
  }

  const response = await dispatcher.dispatch(ctx.parsedBody as JSONRPCMessage, context);
  if (response) ctx.body = response;
  else ctx.status = 202; // a notification — nothing to return
});
```

## Session modes

`McpConfig.sessionMode` selects the transport strategy over one shared core (the same handler maps, factory, auth, and request context back both):

|                                                             | `'stateless'` (default)                                    | `'stateful'`                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| Per request                                                 | fresh `Server` via `KoaMcpTransport`, one JSON response    | reuses a `Server` + `StreamableHTTPServerTransport` per `Mcp-Session-Id` |
| `initialize`                                                | independent per request                                    | once per session                                                         |
| Server→client push (progress, notifications, sampling, SSE) | not available                                              | available                                                                |
| Scaling                                                     | trivial — no session affinity, any node serves any request | requires session affinity (sticky routing or externalized session state) |

Start stateless; it covers request/response tool servers and scales horizontally. Switch to stateful when you need streaming or server-initiated messages. For multi-node stateful deployments, front `McpSessionRegistry` with sticky routing or externalize session/event state (the SDK's `eventStore`, backed by the optional [`@maroonedsoftware/cache`](../cache) peer).

## Authentication

`verifyMcpBearer` is a pure helper: it extracts the `Authorization: Bearer <token>` header and compares it, in constant time, against the configured `bearerToken`.

```ts
import { httpError } from '@maroonedsoftware/errors';
import { isBlankBearerToken, verifyMcpBearer, McpError } from '@maroonedsoftware/mcp';

// `McpConfig.bearerToken` is optional, so settle what it is before verifying against
// it. There is nothing to compare an unset or blank token to, and that is a server
// fault rather than a rejected request.
const { bearerToken } = mcpConfig;
if (bearerToken === undefined || isBlankBearerToken(bearerToken)) {
  throw httpError(500).withInternalDetails({ field: 'bearerToken' });
}

try {
  const auth = verifyMcpBearer({ authorization: req.headers.authorization, expectedToken: bearerToken });
  // auth.token — extend verifyMcpBearer to resolve auth.subject / auth.scopes from real claims
} catch (err) {
  if (err instanceof McpError) throw httpError(401).withCause(err); // reason: 'missing_token' | 'invalid_token'
}
```

`McpAuthPolicy` does all of that for you, including deciding what an unset token means. Reach for `verifyMcpBearer` directly only outside a policy.

The endpoint is never open by omission. `McpAuthPolicy` throws unless the config says something definite: a `bearerToken` to enforce, or `allowUnauthenticated: true` to run with none. A missing key and a blank string both fail closed, since neither shows that anyone chose to run unauthenticated. Setting both enforces the token, the more restrictive of the two.

The check runs on the first MCP request rather than at boot, because the package has no module lifecycle to hook. Evaluate the policy in your own module `setup` if you want a misconfigured server to refuse to start.

> **This is a scaffold-grade seam.** A production MCP server acts as an OAuth 2.0 resource server and validates a JWT access token's signature, `aud`, `exp`, and scopes against an authorization server. Swap `verifyMcpBearer` (or subclass `McpAuthPolicy`) for that, keeping the same `(request) → McpAuthInfo | throw` shape so the route wiring is unchanged.

### As a policy

`McpAuthPolicy` wraps `verifyMcpBearer` as a `@maroonedsoftware/policies` policy: it allows on a valid token (or when `allowUnauthenticated` is set and no token is configured), throws on a config that states neither, and denies with the verifier's `reason` plus a `WWW-Authenticate` challenge header. Its context (`getHeader` + `options`) is structurally compatible with `@maroonedsoftware/koa`'s `SignaturePolicyContext<McpAuthOptions>`, so `requireSignature` drives it — no koa dependency in this package:

```ts
import { McpAuthPolicy, MCP_AUTH_POLICY } from '@maroonedsoftware/mcp';

registry.set(MCP_AUTH_POLICY, McpAuthPolicy);
router.post('/mcp', requireSignature<McpAuthOptions>('mcp', { policy: MCP_AUTH_POLICY }), handler);
```

`requireSignature` can only allow or deny, so the identity the policy verified is discarded. When a handler needs it on `context.auth`, call `assertMcpAuth` in the route instead. It evaluates the same policy through `PolicyService` and returns what the policy resolved, verifying the credential once:

```ts
const auth = await assertMcpAuth(ctx.container, name => ctx.get(name));
const context = createMcpRequestContext({ requestId: ctx.requestId, logger: ctx.logger, authenticationSession: ctx.authenticationSession, auth });
```

The identity travels back through an `onResolved` callback on the policy context, so a subclass that swaps the static token for real OAuth validation should call `context.onResolved?.(auth)` with the claims it resolved. `assertMcpAuth` returns `undefined` when the policy allowed the request without authenticating anyone, which is what the bundled scaffold does with no `bearerToken` configured.

### Per-tool enforcement

The guard on `POST /mcp` gates the mount, not the individual tools. Once a caller clears it, every registered tool is callable — including tools generated from operations whose HTTP routes carry a stricter policy. A tool that needs its own rule enforces it in `handle`, using the session the route put on the context:

```ts
import { PolicyService } from '@maroonedsoftware/policies';
import { requireMcpAuthenticationSession, type McpToolContext } from '@maroonedsoftware/mcp';

@Injectable()
class RefundPaymentTool implements McpToolHandler {
  readonly definition = {/* … */} as const;

  constructor(
    private readonly payments: PaymentsService,
    private readonly policies: PolicyService,
  ) {}

  async handle(args: Record<string, unknown>, context: McpToolContext) {
    const session = requireMcpAuthenticationSession(context);
    await this.policies.assert('payments.write', { session });

    const { paymentId } = await parseAndValidate(args, RefundArgs);
    return { content: [{ type: 'text' as const, text: await this.payments.refund(paymentId) }] };
  }
}
```

Relationship-based checks compose the same way. Inject the `AuthorizationModel` and `PermissionsTupleRepository` from [`@maroonedsoftware/permissions`](../permissions), take the object id from the tool's own `args`, and use `session.subject` as the subject — ideally inside a policy, so the HTTP route and the tool evaluate one rule rather than two copies of it.

> This needs a route that resolves an identity. The bundled `McpAuthPolicy` checks a shared token and identifies nobody, so behind it `context.authenticationSession` is unset and every check above fails closed. Run the real authentication stack (a JWT scheme handler, for instance) on the MCP route when you want per-tool enforcement.

Note that an error thrown from a handler — the 401 above, or `assert`'s 403 — is returned as a JSON-RPC error inside a 200 response. The status code and `WWW-Authenticate` header do not reach the client.

## Limitations

- Streamable HTTP only. stdio transport is out of scope.
- The bundled auth is a static shared token; wire real OAuth resource-server validation before production.
- Stateful mode assumes single-process session storage unless you externalize it (see [session modes](#session-modes)).

## License

MIT — see [LICENSE](./LICENSE).
