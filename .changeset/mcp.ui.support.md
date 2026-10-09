---
'@maroonedsoftware/mcp': minor
---

Serve MCP Apps (MCP UI). `withMcpUi(tool, { resourceUri, visibility })` links a tool to a `ui://` resource, and `McpUiResource` is a base class that serves the app HTML with the `text/html;profile=mcp-app` MIME type and `_meta.ui` (CSP, permissions, domain, border). Handlers read `mcpUiSupport(context)` to tell whether the client renders apps: the context now carries the `clientCapabilities` negotiated in a stateful session (`'unknown'` in stateless mode). The server advertises the `io.modelcontextprotocol/ui` extension when any tool or resource carries UI, and in a stateful session a client without the extension gets listings with app-only tools, `_meta.ui`, and `ui://` resources left out.
