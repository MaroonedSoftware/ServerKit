---
'@maroonedsoftware/authentication': minor
---

Add an optional `refreshReuseGrace` to `AuthenticationSessionServiceOptions`. Inside the window, a second presentation of a refresh token returns the pair the first exchange issued and records `session.refresh_reuse_within_grace` instead of revoking the family, so clients that refresh concurrently or retry a lost response (such as MCP hosts) no longer revoke their own session. Unset by default, which keeps every reuse revoking as before.
