---
'@maroonedsoftware/mcp': minor
---

A `tools/call` naming an unregistered tool now returns a tool result with `isError: true` instead of a JSON-RPC error. Its text names the tool and up to three of the closest tools this client was listed (sharing an underscore-separated word with the guess, or a few edits away), so the model can retry with a real name. The matching is exported as `closestMcpNames`, with `unknownMcpToolMessage` and `MCP_CLOSEST_NAMES_LIMIT`.
