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
