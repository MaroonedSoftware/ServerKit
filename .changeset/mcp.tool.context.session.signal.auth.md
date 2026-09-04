---
'@maroonedsoftware/mcp': minor
---

Carry the ServerKit authentication session into MCP handler contexts.
`createMcpRequestContext` accepts `authenticationSession`, and `McpRequestContext`,
`McpToolContext`, and `McpResourceContext` all expose it, so a tool or resource handler can
evaluate a policy for the caller instead of relying solely on the guard mounted on the route.
Build the context from `ctx.requestId`, `ctx.logger`, and `ctx.authenticationSession` (Koa) or the
same three fields on `request` (Fastify). The field is optional, so existing wiring is unchanged.
Note it is unrelated to the MCP transport session behind `Mcp-Session-Id`.

Add `requireMcpAuthenticationSession(context)`, which narrows a handler context to an authenticated
`AuthenticationSession` or throws 401, mirroring the session check in Koa's `requirePolicy`. A tool
generated from an operation that declares a policy calls it and then
`PolicyService.assert(policy, { session })`, so the tool enforces the same rule as its HTTP route
rather than relying on the guard mounted on `POST /mcp`.

Forward the SDK's per-request abort signal to handlers, combined with `McpConfig.requestTimeoutMs`.
`context.signal` was previously always `undefined` despite being documented, and `requestTimeoutMs`
was declared but never read, so neither client cancellation nor the configured timeout could stop a
handler. Both now abort the signal a handler receives. Cancellation stays cooperative: a handler
that does not forward the signal still runs to completion. `MCP_DEFAULT_REQUEST_TIMEOUT_MS` moved
from the dispatcher module to the config module, next to the field it documents; the exported name
is unchanged.

Populate `context.auth`. `McpAuthPolicy` used to verify the bearer token and discard the
`McpAuthInfo` it produced, so the field was never set by any bundled wiring. The policy context now
carries an optional `onResolved` callback the policy invokes with the identity it resolved, and the
new `assertMcpAuth(container, getHeader)` gates a route on `MCP_AUTH_POLICY` and returns that
identity for `createMcpRequestContext`. It replaces `requireSignature` on the MCP route when a
handler needs `context.auth`; `requireSignature` still works where it does not. A policy subclass
that swaps the static token for real validation should call `onResolved` with its claims.

That whole header-reading path ships **deprecated** in this same release, superseded by
`McpAuthenticationHandler` — see the accompanying changeset. It is described here because the code
is present and functional, not because it is the path to build on.

Extract `McpContextBase`, the request-scoped fields `McpRequestContext`, `McpToolContext`, and
`McpResourceContext` all carry, and have the three extend it. `CreateMcpRequestContextInput` is now
an alias for it, since the factory takes exactly those fields. This is a type-authoring change with
no effect on consumers, TypeScript being structural: the three context types resolve to the same
shapes they had before. It means the next request-scoped value is declared once rather than four
times.

Stop a blank `McpConfig.bearerToken` from silently opening the MCP endpoint. `McpAuthPolicy` tested
the configured token for falsiness, so an empty or whitespace-only string, typically a blank
environment variable, took the same branch as leaving the key out and allowed every request. An
unset token still means "intentionally open" and allows; a configured-but-blank one now throws as
the server misconfiguration it is. `verifyMcpBearer` rejects a blank `expectedToken` the same way,
with `internalDetails.kind` of `misconfiguration` rather than an authentication reason code, since
no credential can satisfy it. The new `isBlankBearerToken` predicate exposes the distinction for
consumers validating their own config at bootstrap.

**Breaking:** running the MCP endpoint with no authentication now has to be stated in config.
`McpAuthPolicy` previously allowed every request when `McpConfig.bearerToken` was unset, so an
endpoint could be wide open because a key was missing, which is invisible to anyone reviewing the
config. It now throws unless the config says something definite: a `bearerToken` to enforce, or the
new `allowUnauthenticated: true` to run with none. Setting both enforces the token. Existing
deployments that configure a token are unaffected. A setup that relied on the old tokenless
default, typically local development, needs `allowUnauthenticated: true` added, and
`McpAuthOptions` widens to include the flag. The check runs on the first MCP request rather than at
boot, since the package has no module lifecycle and validating in the dispatcher would wrongly
refuse to boot a server that swapped in its own auth policy.

Correct the signature of `isBlankBearerToken`, which shipped in this same release as a
`bearerToken is string` type predicate. That is true of the blank case, so ruling blank out and
then `undefined` narrowed a perfectly good token to `never`. It compiled only because `never` is
assignable to everything. It returns a plain `boolean` now, and a typed test pins the narrowing.
