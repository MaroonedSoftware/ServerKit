---
'@maroonedsoftware/authentication': minor
'@maroonedsoftware/fastify': patch
'@maroonedsoftware/koa': patch
---

Export `MFA_SATISFIED_POLICY` (`'auth.session.mfa.satisfied'`) from
`@maroonedsoftware/authentication`, and use it as the `requirePolicy()` default in
`@maroonedsoftware/koa` and `@maroonedsoftware/fastify` instead of the private literal each package
declared for itself.

The default gate is unchanged; only its source moved. What changes is that code mirroring the HTTP
default from off the route path — a background job, or a `@maroonedsoftware/mcp` tool enforcing the
same rule its route does — can reference the constant rather than carrying a copy of the string that
silently diverges if the default ever changes.

`MFA_SATISFIED_POLICY` is the only one of the eleven bundled policy names exported this way, because
it is the only one that is a default rather than an explicit choice at the call site. The others stay
literals.
