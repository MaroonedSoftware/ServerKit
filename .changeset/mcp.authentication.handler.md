---
'@maroonedsoftware/mcp': minor
---

Add `McpAuthenticationHandler`, so the MCP shared bearer token resolves an `AuthenticationSession`
and the endpoint authenticates through the same stack as every other route.

This fixes a real incompatibility. `authenticationPlugin` (fastify) and `authenticationMiddleware`
(koa) hand the `Authorization` header to `AuthenticationSchemeHandler` and then delete it from the
request, keeping only the resolved session. The existing MCP auth path re-reads that header
(`McpAuthPolicy` via `assertMcpAuth` or `requireSignature`), so it saw nothing and denied every
request on any server using the default plugin or middleware stack. The two were mutually exclusive.

Register the handler under the `bearer` scheme, through `ChainedAuthenticationHandler` when the
server also serves JWT bearer traffic:

```ts
registry.register(McpAuthenticationHandler).useClass(McpAuthenticationHandler).asSingleton();
registry.register(AuthenticationHandlerChain).useArray(AuthenticationHandlerChain).push(McpAuthenticationHandler).push(JwtAuthenticationHandler);
registry.register(ChainedAuthenticationHandler).useClass(ChainedAuthenticationHandler).asSingleton();
registry.register(AuthenticationHandlerMap).useMap(AuthenticationHandlerMap).set('bearer', ChainedAuthenticationHandler);
```

The session it mints is honest about being a shared secret rather than dressed up as a user session.
`factors` is empty, because no `AuthenticationFactorMethod` describes a static token — which means
`requirePolicy()`'s default MFA gate rejects it, so mount the MCP route with `{ policy: false }`.
`sessionToken` is a fresh random value per request, never the bearer token, so the credential cannot
leak through anything that logs a session and nothing mistakes it for a stored, revocable key. The
lifetime is the request's. `claims.mcp` marks the session so an app's policy override can recognise
it.

Misconfiguration throws rather than declining: a blank `bearerToken`, or no token without
`allowUnauthenticated`, is the server's fault and surfaces as a 500. A token mismatch declines
quietly, logged at `debug`, since behind a chain this handler sees every bearer request.

Also new: `McpConfig.subject` names the client on the session (default `MCP_DEFAULT_SUBJECT`,
`'mcp'`), and `compareMcpToken` exposes the constant-time comparison at the token level, for callers
handed the credential already separated from its scheme.

`requireMcpPolicy(context, policies, options?)` collapses the per-tool session-plus-assert pair that
every gated handler was writing by hand. It narrows the session (401), asserts the policy against it
(403), and returns the session. `policy` defaults to `false` — session only — rather than to
`MFA_SATISFIED_POLICY` as the HTTP `requirePolicy()` does, precisely because the scaffold session has
no factors. It takes a `PolicyService` rather than a `Container`, since a handler context is
transport-neutral and carries no injectkit types while handlers are `@Injectable()`.

**Deprecated:** the header-reading path shipped in 0.2.0, all still functional and removed in a later
major —
`assertMcpAuth`, `McpAuthPolicy`, `MCP_AUTH_POLICY`, `McpAuthPolicyContext`, `verifyMcpBearer`,
`VerifyMcpBearerInput`, `McpAuthInfo`, `McpAuthOptions`, `MCP_AUTHORIZATION_HEADER`, and
`McpContextBase.auth`. Two reasons. It cannot see the `Authorization` header behind the
authentication stack, as above; and it carries a second identity model, `context.auth`, alongside
`context.authenticationSession`, so a handler reading the wrong one fails open or closed depending on
how the route was wired. The replacement for each is `McpAuthenticationHandler` plus
`authenticationSession`; for `verifyMcpBearer` specifically it is `compareMcpToken` and
`isBlankBearerToken`, which is what the handler uses.

