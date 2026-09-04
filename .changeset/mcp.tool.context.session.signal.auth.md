---
'@maroonedsoftware/mcp': minor
---

Carry the ServerKit authentication session into MCP handler contexts.
`createMcpRequestContext` accepts `authenticationSession`, and `McpRequestContext`,
`McpToolContext`, and `McpResourceContext` all expose it, so a tool or resource handler can
evaluate a policy for the caller instead of relying solely on the guard mounted on the route.
Build the context from `ctx.requestId`, `ctx.logger`, and `ctx.authenticationSession` (Koa) or the
same three fields on `request` (Fastify). The field is optional, so existing wiring is unchanged.
Note it is unrelated to the MCP transport session behind `Mcp-Session-Id`.

Add `requireMcpAuthenticationSession(context)`, which narrows a handler context to an authenticated
`AuthenticationSession` or throws 401, mirroring the session check in Koa's `requirePolicy`. A tool
generated from an operation that declares a policy calls it and then
`PolicyService.assert(policy, { session })`, so the tool enforces the same rule as its HTTP route
rather than relying on the guard mounted on `POST /mcp`.

Forward the SDK's per-request abort signal to handlers, combined with `McpConfig.requestTimeoutMs`.
`context.signal` was previously always `undefined` despite being documented, and `requestTimeoutMs`
was declared but never read, so neither client cancellation nor the configured timeout could stop a
handler. Both now abort the signal a handler receives. Cancellation stays cooperative: a handler
that does not forward the signal still runs to completion. `MCP_DEFAULT_REQUEST_TIMEOUT_MS` moved
from the dispatcher module to the config module, next to the field it documents; the exported name
is unchanged.

Populate `context.auth`. `McpAuthPolicy` used to verify the bearer token and discard the
`McpAuthInfo` it produced, so the field was never set by any bundled wiring. The policy context now
carries an optional `onResolved` callback the policy invokes with the identity it resolved, and the
new `assertMcpAuth(container, getHeader)` gates a route on `MCP_AUTH_POLICY` and returns that
identity for `createMcpRequestContext`. It replaces `requireSignature` on the MCP route when a
handler needs `context.auth`; `requireSignature` still works where it does not. A policy subclass
that swaps the static token for real validation should call `onResolved` with its claims.
