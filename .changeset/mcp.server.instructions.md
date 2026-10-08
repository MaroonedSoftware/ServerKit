---
'@maroonedsoftware/mcp': minor
---

`McpConfig` gains an optional `instructions` string, sent to clients as `instructions` in the `initialize` result. Clients that honour it (Claude among them) put it in the model's context as soon as the server is attached, which makes it the place to say what the server is for and how its tools fit together. Omitted from `initialize` when unset or blank, exactly as before.
