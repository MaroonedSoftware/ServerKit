# @maroonedsoftware/mcp

## 0.1.0

### Minor Changes

- b27b697: Add `@maroonedsoftware/mcp`: Model Context Protocol server support that wraps the official SDK behind ServerKit's DI/Koa patterns. Register tools and resources as `@Injectable()` handler maps and serve them through `McpDispatcher` over Streamable HTTP, with stateless (default) and stateful session modes, `AsyncLocalStorage`-backed request context, and bearer auth as a `@maroonedsoftware/policies` policy.
