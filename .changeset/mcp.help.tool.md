---
'@maroonedsoftware/mcp': minor
---

Add `McpHelpToolHandler`, an opt-in tool that answers with an overview followed by every other registered tool and its description. A tool is the one channel every MCP client exposes, so it covers clients that ignore server `instructions`. Its `overview` takes the same `McpInstructions` as the dispatcher, resolved on every call, so it can reflect the caller's current role where `instructions` is fixed at `initialize`. Register it in the map it lists; the name defaults to `help`.
