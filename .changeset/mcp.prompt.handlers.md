---
'@maroonedsoftware/mcp': minor
---

Serve MCP prompts. `McpPromptHandler` (`definition` plus `get(args, context)`) and its `McpPromptHandlerMap` DI token mirror the tool and resource handlers: `prompts/list` is memoized at construction, `prompts/get` runs inside the request context with a per-prompt `McpPromptContext` (`context.forPrompt(name, signal)`), and the `prompts` capability is advertised only when the map is non-empty. `McpHelpToolHandler` takes an optional `prompts` map and lists them after the tools.

**Wiring change:** `McpServerFactory` now injects `McpPromptHandlerMap`, so a container must register it, even empty: `registry.register(McpPromptHandlerMap).useMap(McpPromptHandlerMap)`. Code constructing the factory by hand passes the prompt map after the resource map.
