---
'@maroonedsoftware/mcp': minor
---

`McpDispatcher.dispatch` and `dispatchStateful` take an optional `{ instructions }` that overrides `McpConfig.instructions` for that call. It is fixed text or a function of the request context (`McpInstructions`), so one container can serve a different welcome per endpoint, or tailor it to the caller's `authenticationSession`. The function runs only for an `initialize` message, and in stateful mode the session keeps its answer. Returning `undefined` falls back to the configured text; `''` sends none. `McpServerFactory.create` and `McpSessionRegistry.handle` take the matching optional argument. Existing calls are unchanged.
