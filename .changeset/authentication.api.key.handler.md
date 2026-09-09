---
'@maroonedsoftware/authentication': minor
---

Add `ApiKeyAuthenticationHandler` and the two policies that gate machine routes.

The handler declines on scheme and prefix before doing any I/O, which is why it belongs first in a
`ChainedAuthenticationHandler`: every JWT in a chained deployment reaches it, and none of them
should cost a parse or a query. `ApiKeyServiceOptions.schemes` defaults to `['bearer']` for client
compatibility and accepts `'apikey'` for applications that prefer `Authorization: ApiKey sk_…`,
which the scheme map can dispatch directly without a chain.

An API key session carries one factor, so `requirePolicy()`'s default MFA gate rejects it — a
machine credential must not reach an MFA-gated route by accident. `API_KEY_SESSION_POLICY` gates a
machine-only route and optionally checks a scope, denying with `WWW-Authenticate: Bearer
error="insufficient_scope"` so a client can tell a wrong key from a key lacking a permission.
`MFA_SATISFIED_OR_API_KEY_POLICY` accepts either an MFA-satisfied person or a key, for a path that
serves both. `getApiKeyClaim` is exported for applications writing their own rules.

Scope enforcement lives in the policy rather than the service because what a scope permits is a
property of the route, and the service does not know which route a key was presented to.
