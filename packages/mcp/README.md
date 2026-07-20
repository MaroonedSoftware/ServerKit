# @maroonedsoftware/mcp

Transport-agnostic [Model Context Protocol](https://modelcontextprotocol.io) **server** support for ServerKit. It wraps the official [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) so it fits ServerKit's patterns instead of owning your stack:

- tools and resources are DI-registered `@Injectable()` handler maps (like the Discord/Slack dispatchers), not imperative `server.tool()` calls;
- the SDK's low-level `Server` stays the protocol engine (JSON-RPC framing, capability negotiation, `initialize`), while registration and transport are ServerKit-native seams;
- request context (request id, logger, auth subject) is threaded to handlers via `AsyncLocalStorage`, so one set of handlers serves concurrent requests safely.

The package owns no HTTP routes — wire `McpDispatcher` from your own Koa (or Express/Fastify/Lambda) handler. It targets MCP over **Streamable HTTP**; stdio transport is out of scope.

## Installation

```bash
pnpm add @maroonedsoftware/mcp @modelcontextprotocol/sdk
```

## Exports

| Symbol | Purpose |
|--------|---------|
| `McpConfig` | Abstract `@Injectable()` token; carries `serverName`, `version`, optional `sessionMode`, `bearerToken`, `requestTimeoutMs`. Consumer registers a concrete value. |
| `McpDispatcher` | Entry point. `dispatch(message, context)` for stateless mode; `dispatchStateful(exchange, context)` for stateful. Selects the mode from `McpConfig.sessionMode`. |
| `McpServerFactory` | Builds SDK `Server` instances wired to the handler maps — memoizes the `tools/list` payload and uses stable, ALS-backed request handlers. |
| `McpToolHandler` / `McpToolHandlerMap` | One-method tool handler interface (`handle(args, context)`) + its `Map<toolName, handler>` DI token. |
| `McpResourceHandler` / `McpResourceHandlerMap` | Resource handler interface (`read(uri, context)`) + its `Map<uri, handler>` DI token. |
| `McpSessionRegistry` | Stateful-mode registry: one SDK `Server` + `StreamableHTTPServerTransport` per `Mcp-Session-Id`, reused across the session. |
| `KoaMcpTransport` | Minimal single-exchange `Transport` for stateless mode (one JSON-RPC message in, one response out). |
| `McpRequestContext` / `createMcpRequestContext` | Request-scoped context threaded to handlers, plus the factory that builds one from your `ctx`. |
| `verifyMcpBearer(input)` | Pure bearer-token verifier. Returns `McpAuthInfo` or throws `McpError`. **Scaffold-grade** — swap for OAuth resource-server JWT validation. |
| `McpAuthPolicy` | `@maroonedsoftware/policies` form of `verifyMcpBearer` (registered under `MCP_AUTH_POLICY`). Slots into koa's `requireSignature`. |
| `McpError` / `IsMcpError` | `ServerkitError` subclass for non-HTTP domain failures, plus its type guard. |

## Configuration

The package does not read `AppConfig` itself — services take `McpConfig` directly via DI. Resolve it at bootstrap and register it:

```ts
import { AppConfigBuilder, AppConfigSourceJson } from '@maroonedsoftware/appconfig';
import { McpConfig } from '@maroonedsoftware/mcp';

const appConfig = await new AppConfigBuilder().addSource(new AppConfigSourceJson('./config.json')).build();

const mcpConfig = appConfig.getAs<McpConfig>('mcp');
container.register(McpConfig, { useValue: mcpConfig });
```

```jsonc
// config.json
{
  "mcp": {
    "serverName": "my-service",
    "version": "1.0.0",
    "sessionMode": "stateless", // optional; "stateless" (default) or "stateful"
    "bearerToken": "${env:MCP_BEARER_TOKEN}", // optional; enables the bundled auth policy
    "requestTimeoutMs": 30000 // optional
  }
}
```

| Field | Required | Used by |
|-------|----------|---------|
| `serverName` | yes | Advertised to clients as `serverInfo.name` during `initialize`. |
| `version` | yes | Advertised as `serverInfo.version`. |
| `sessionMode` | no | `'stateless'` (default) or `'stateful'` — see [session modes](#session-modes). |
| `bearerToken` | no | Shared token accepted by `McpAuthPolicy`. Unset ⇒ the endpoint is open (development only). |
| `requestTimeoutMs` | no | Per-request handler timeout. Defaults to `MCP_DEFAULT_REQUEST_TIMEOUT_MS` (30s). |

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
const tools = new McpToolHandlerMap();
tools.set('search_docs', container.get(SearchDocsTool));
container.register(McpToolHandlerMap, { useValue: tools });
container.register(McpResourceHandlerMap, { useValue: new McpResourceHandlerMap() }); // empty is fine
```

Resources follow the same shape with `McpResourceHandler` (`read(uri, context)`), registered by URI in `McpResourceHandlerMap`. The dispatcher advertises only the capabilities backed by a non-empty map, so a tools-only server doesn't claim resource support.

## Serving MCP

You own the route. Gate it with the auth policy, build an `McpRequestContext` from `ctx`, and dispatch. The mode is chosen from `McpConfig.sessionMode`:

```ts
import { requireSignature } from '@maroonedsoftware/koa';
import { McpDispatcher, createMcpRequestContext, MCP_AUTH_POLICY, type McpAuthOptions } from '@maroonedsoftware/mcp';

router.post('/mcp', requireSignature<McpAuthOptions>('mcp', { policy: MCP_AUTH_POLICY }), async (ctx) => {
  const dispatcher = ctx.container.get(McpDispatcher);
  const context = createMcpRequestContext({ requestId: ctx.requestId, logger: ctx.logger });

  if (dispatcher.sessionMode === 'stateful') {
    ctx.respond = false; // hand the raw response stream to the SDK transport (SSE)
    await dispatcher.dispatchStateful(
      { req: ctx.req, res: ctx.res, body: ctx.request.body, sessionId: ctx.get('mcp-session-id') || undefined },
      context,
    );
    return;
  }

  const response = await dispatcher.dispatch(JSON.parse(ctx.rawBody), context);
  if (response) ctx.body = response;
  else ctx.status = 202; // a notification — nothing to return
});
```

## Session modes

`McpConfig.sessionMode` selects the transport strategy over one shared core (the same handler maps, factory, auth, and request context back both):

| | `'stateless'` (default) | `'stateful'` |
|-|-------------------------|--------------|
| Per request | fresh `Server` via `KoaMcpTransport`, one JSON response | reuses a `Server` + `StreamableHTTPServerTransport` per `Mcp-Session-Id` |
| `initialize` | independent per request | once per session |
| Server→client push (progress, notifications, sampling, SSE) | not available | available |
| Scaling | trivial — no session affinity, any node serves any request | requires session affinity (sticky routing or externalized session state) |

Start stateless; it covers request/response tool servers and scales horizontally. Switch to stateful when you need streaming or server-initiated messages. For multi-node stateful deployments, front `McpSessionRegistry` with sticky routing or externalize session/event state (the SDK's `eventStore`, backed by the optional [`@maroonedsoftware/cache`](../cache) peer).

## Authentication

`verifyMcpBearer` is a pure helper: it extracts the `Authorization: Bearer <token>` header and compares it, in constant time, against the configured `bearerToken`.

```ts
import { verifyMcpBearer, McpError } from '@maroonedsoftware/mcp';

try {
  const auth = verifyMcpBearer({ authorization: req.headers.authorization, expectedToken: mcpConfig.bearerToken });
  // auth.token — extend verifyMcpBearer to resolve auth.subject / auth.scopes from real claims
} catch (err) {
  if (err instanceof McpError) throw httpError(401).withCause(err); // reason: 'missing_token' | 'invalid_token'
}
```

> **This is a scaffold-grade seam.** A production MCP server acts as an OAuth 2.0 resource server and validates a JWT access token's signature, `aud`, `exp`, and scopes against an authorization server. Swap `verifyMcpBearer` (or subclass `McpAuthPolicy`) for that, keeping the same `(request) → McpAuthInfo | throw` shape so the route wiring is unchanged.

### As a policy

`McpAuthPolicy` wraps `verifyMcpBearer` as a `@maroonedsoftware/policies` policy: it allows on a valid token (or when no token is configured), and denies with the verifier's `reason` plus a `WWW-Authenticate` challenge header. Its context (`getHeader` + `options`) is structurally compatible with `@maroonedsoftware/koa`'s `SignaturePolicyContext<McpAuthOptions>`, so `requireSignature` drives it — no koa dependency in this package:

```ts
import { McpAuthPolicy, MCP_AUTH_POLICY } from '@maroonedsoftware/mcp';

registry.set(MCP_AUTH_POLICY, McpAuthPolicy);
router.post('/mcp', requireSignature<McpAuthOptions>('mcp', { policy: MCP_AUTH_POLICY }), handler);
```

## Limitations

- Streamable HTTP only. stdio transport is out of scope.
- The bundled auth is a static shared token; wire real OAuth resource-server validation before production.
- Stateful mode assumes single-process session storage unless you externalize it (see [session modes](#session-modes)).

## License

MIT
