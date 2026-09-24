---
'@maroonedsoftware/mcp': minor
---

`McpAuthenticationHandler` no longer logs when a bearer token does not match. Behind `ChainedAuthenticationHandler` every JWT-bearing request reaches it, so the line fired on every request; the chain now logs once when no handler accepts the credential. The handler no longer injects a `Logger`, so code that constructs it by hand drops the second constructor argument. DI registration is unchanged.
