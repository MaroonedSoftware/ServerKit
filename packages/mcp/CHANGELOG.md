# @maroonedsoftware/mcp

## 0.2.0

### Minor Changes

- 998a767: Carry the ServerKit authentication session into MCP handler contexts.
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

## 0.1.13

### Patch Changes

- 0dd2dbb: Correct the JSDoc naming where a Fastify app's parsed JSON body comes from. It is now the ordinary
  `request.body`, populated by the Fastify adapter's `bodyParserPlugin`, rather than
  `request.parsedBody`. No runtime change.

## 0.1.12

### Patch Changes

- 7741b47: Fix the Koa route example in the MCP docs: it read the request payload from `ctx.request.body`, which ServerKit never populates, and omitted the `bodyParserMiddleware` call that actually fills `ctx.parsedBody` and `ctx.rawBody`. The example now parses the body and dispatches `ctx.parsedBody` in both session modes.

## 0.1.11

### Patch Changes

- Updated dependencies [97a75be]
  - @maroonedsoftware/errors@1.9.1
  - @maroonedsoftware/policies@0.6.9

## 0.1.10

### Patch Changes

- d0264f8: Fix handler-map wiring examples to use `useMap` instead of resolving handlers from a container that
  does not exist yet.

  The examples built each map eagerly — `map.set('key', container.get(Handler))` followed by
  `registry.register(Map).useValue(map)` — which reads as if a built container were available inside
  the composition root, before `build()` has been called. They now use injectkit's `useMap`, which
  takes handler _tokens_ and resolves them when the container is built:

  ```ts
  registry.register(SearchDocsTool).useClass(SearchDocsTool).asSingleton();
  registry.register(McpToolHandlerMap).useMap(McpToolHandlerMap).set('search_docs', SearchDocsTool);
  ```

  The examples now also register each handler class explicitly. Auto-registration of `@Injectable()`
  classes is off by default, so omitting that step fails the build with
  `Missing dependencies for <Map>: <Handler>` — a step the old `container.get` form hid.

  Also corrects `.useMap()` to `.useMap(MapClass)` and `.add(key, token)` to `.set(key, token)` in the
  `koa` and `authentication` examples, switches the `PolicyRegistryMap` example to `useFactory` (it
  maps to policy _tokens_, so `useMap` does not apply), and lowercases the `AuthenticationHandlerMap`
  key in koa's example, since the scheme handler lowercases before lookup and `'Bearer'` never matched.

  Docs only, no runtime change.

- cc6d2d6: Fix DI registration examples in READMEs and JSDoc to use the real injectkit API.

  The examples showed `container.register(Token, { useValue: value })`, which does not exist:
  injectkit's `Container` has no `register` method, and registration is fluent off the registry.
  Every occurrence now reads `registry.register(Token).useValue(value)`, matching each package's
  `AGENTS.md` and the wiring used in the test suites. Docs only, no runtime change.

## 0.1.9

### Patch Changes

- Updated dependencies [8557da7]
  - @maroonedsoftware/policies@0.6.8

## 0.1.8

### Patch Changes

- 7587006: Update runtime dependency ranges across the workspace (injectkit ^1.7.1, zod ^4.5.4, deepmerge-ts ^8, raw-body ^4, qs ^6.16, kysely ^0.29.5, pg ^8.23, @modelcontextprotocol/sdk ^1.30, @fastify/busboy ^3.2.2, and related minors).
- Updated dependencies [7587006]
- Updated dependencies [7587006]
  - @maroonedsoftware/cache@0.5.0
  - @maroonedsoftware/logger@1.1.9
  - @maroonedsoftware/policies@0.6.7

## 0.1.7

### Patch Changes

- Updated dependencies [e2e968d]
  - @maroonedsoftware/errors@1.9.0
  - @maroonedsoftware/policies@0.6.6

## 0.1.6

### Patch Changes

- be035ce: Ship the MIT LICENSE file in the published package tarball, and link to it from the README.
- Updated dependencies [be035ce]
  - @maroonedsoftware/cache@0.4.5
  - @maroonedsoftware/errors@1.8.5
  - @maroonedsoftware/logger@1.1.8
  - @maroonedsoftware/policies@0.6.5

## 0.1.5

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/cache@0.4.4
  - @maroonedsoftware/errors@1.8.4
  - @maroonedsoftware/logger@1.1.7
  - @maroonedsoftware/policies@0.6.4

## 0.1.4

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/cache@0.4.3
  - @maroonedsoftware/errors@1.8.3
  - @maroonedsoftware/logger@1.1.6
  - @maroonedsoftware/policies@0.6.3

## 0.1.3

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/cache@0.4.2
  - @maroonedsoftware/errors@1.8.2
  - @maroonedsoftware/logger@1.1.5
  - @maroonedsoftware/policies@0.6.2

## 0.1.2

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies [2a2bcf4]
- Updated dependencies
  - @maroonedsoftware/cache@0.4.1
  - @maroonedsoftware/errors@1.8.1
  - @maroonedsoftware/logger@1.1.4
  - @maroonedsoftware/policies@0.6.1

## 0.1.1

### Patch Changes

- Updated dependencies [b7e1163]
  - @maroonedsoftware/policies@0.6.0

## 0.1.0

### Minor Changes

- b27b697: Add `@maroonedsoftware/mcp`: Model Context Protocol server support that wraps the official SDK behind ServerKit's DI/Koa patterns. Register tools and resources as `@Injectable()` handler maps and serve them through `McpDispatcher` over Streamable HTTP, with stateless (default) and stateful session modes, `AsyncLocalStorage`-backed request context, and bearer auth as a `@maroonedsoftware/policies` policy.
