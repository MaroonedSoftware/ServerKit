---
'@maroonedsoftware/mcp': minor
---

A failed tool call can be explained to the model instead of failing the protocol.

- `ExplainedToolHandler` wraps a tool, and `explainToolErrors(map)` wraps every tool in a `McpToolHandlerMap`. A thrown `HttpError` becomes a tool result with `isError: true`:
  - 400/422 list each invalid or missing field by path (without a `body.`/`query.` prefix), then ask the model to get these from the user and call again.
  - 401/403 say the caller is not allowed, naming the scope of an `insufficient_scope` `WWW-Authenticate` challenge.
  - 404/409 relay the message.
  - Any other status gets a generic failure, never the internal message, and is logged at `error` on `context.logger`.
- Anything that is not an `HttpError` is rethrown, as before.
