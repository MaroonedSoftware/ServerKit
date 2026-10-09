---
'@maroonedsoftware/authentication': minor
---

Add `SESSION_SCOPE_POLICY` (`auth.session.scope`), which requires a scope of a delegated session: the scopes an OAuth grant was consented to, or an API key's (with `*` as a wildcard). A person's own session carries neither and passes, since scopes only narrow what a delegate may do. `getSessionScopes(session)` reads them. OAuth scopes were previously advertised and echoed but never authorized on.
