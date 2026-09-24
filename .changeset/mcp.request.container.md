---
'@maroonedsoftware/mcp': minor
---

MCP handlers can reach the request's scoped DI container.

- `McpContextBase` gains `container?: Container`, and `createMcpRequestContext` carries it onto the request, tool, and resource contexts. Pass `ctx.container` (Koa) or `request.container` (Fastify) when building the context, and resolve request-scoped services from `context.container` inside a handler.
