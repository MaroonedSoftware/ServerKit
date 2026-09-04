# @maroonedsoftware/koa

## 3.2.3

### Patch Changes

- b2c37da: Export `MFA_SATISFIED_POLICY` (`'auth.session.mfa.satisfied'`) from
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

- 89b874f: Scrub the `Authorization` credential from `rawHeaders` too, closing a leak in both adapters'
  authentication step.

  `authenticationPlugin` (fastify) and `authenticationMiddleware` (koa) delete the header after handing
  it to `AuthenticationSchemeHandler`, so it cannot be captured by downstream logging. But
  `IncomingMessage.rawHeaders` is a separate array Node fills at parse time and never keeps in sync
  with `headers`, so `delete req.headers.authorization` left the token sitting in `req.rawHeaders`.
  Anything serializing that array — a request logger, an error reporter, a proxy replaying headers —
  still captured it, which is precisely what the delete was there to prevent.

  Both adapters now also call the new `stripRawAuthorizationHeader` from `@maroonedsoftware/servercore`,
  which removes every `Authorization` pair from the array in place. It matches the name
  case-insensitively, only ever at an even index (so a header whose _value_ reads `"authorization"`
  survives), and handles duplicates, including adjacent ones.

  No API change for consumers. Code that was reaching into `rawHeaders` to recover the credential after
  the authentication step will now find nothing there — that was never a supported way to read it, and
  the supported one is an `AuthenticationHandler` registered for the scheme.

- Updated dependencies [892a28b]
- Updated dependencies [b2c37da]
- Updated dependencies [89b874f]
  - @maroonedsoftware/authentication@4.31.0
  - @maroonedsoftware/servercore@0.3.0

## 3.2.2

### Patch Changes

- Updated dependencies [6d66a27]
  - @maroonedsoftware/servercore@0.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [0dd2dbb]
  - @maroonedsoftware/servercore@0.2.1

## 3.2.0

### Minor Changes

- eb7a76d: The framework-neutral half of this package now lives in `@maroonedsoftware/servercore` and is
  re-exported here by name, so existing imports keep working: `ServerKitModule`, the body parsers
  and `defaultParserMappings`, `ServerKitBodyParser` / `ServerKitParserMappings`, the signature
  policy (`REQUIRE_SIGNATURE_POLICY`, `DefaultSignaturePolicy`, `SignaturePolicyContext`,
  `SignatureOptions`), `RateLimiter`, and the SSE transport.

  Behavioural notes:

  - `ServerKitBodyParser.parse` now matches content types with `type-is` directly and accepts either
    a raw `IncomingMessage` or any object carrying one as `req` (a Koa context still works).
  - `SseContext.status` is optional and the interface gains an optional `hijack()` hook. A Koa
    context still satisfies it unchanged.
  - `bodyParserMiddleware`, `errorMiddleware`, `rateLimiterMiddleware`, `corsMiddleware`,
    `authenticationMiddleware`, and `requireSignature` delegate to the shared servercore helpers.
    Their wire behaviour (statuses, bodies, headers) is unchanged.
  - `rate-limiter-flexible` is no longer a runtime dependency of this package; it arrives through
    servercore. The parser libraries (`@hapi/bourne`, `raw-body`, `inflation`, `qs`) moved with the
    parsers.
  - `@maroonedsoftware/koa/serverfeed` keeps `serverFeedRouter` and re-exports `handleServerFeed`,
    `ServerFeedContext`, and `serverFeedFilterFromQuery` from
    `@maroonedsoftware/servercore/serverfeed`.
  - `ServerKitServerBuilder.setup` registers `ServerKitContext` as a scoped placeholder (unless a
    module registered it), so a service may declare `ServerKitContext` as a constructor dependency
    and the request scope's override supplies the live context. Resolving it outside a request
    throws, and a singleton depending on it fails container validation.
  - `ServerKitServerBuilder` now extends `ServerKitServerBuilderBase` from servercore. `start()`
    resolves after the socket is bound **and** every module's `start` hook has run, and rejects if
    one throws (previously it resolved before the hooks ran and a throwing hook was an unhandled
    rejection). `DEFAULT_SHUTDOWN_GRACE_MS` and `ServerKitStartOptions` are re-exported unchanged.

### Patch Changes

- Updated dependencies [97a75be]
- Updated dependencies [7c99aba]
  - @maroonedsoftware/errors@1.9.1
  - @maroonedsoftware/servercore@0.2.0
  - @maroonedsoftware/appconfig@2.6.1
  - @maroonedsoftware/authentication@4.30.11
  - @maroonedsoftware/policies@0.6.9

## 3.1.1

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

- Updated dependencies [d0264f8]
  - @maroonedsoftware/authentication@4.30.10

## 3.1.0

### Minor Changes

- 6218dc5: `authenticationMiddleware` accepts an optional `anonymousPaths` whitelist — exact-match strings or RegExps tested against `ctx.path` — for genuinely public routes where resolving and awaiting the scheme handler on every request is pure overhead. A whitelisted route skips the handler entirely: `ctx.authenticationSession` stays `invalidAuthenticationSession`, so `requirePolicy` rejects it exactly as it would any unauthenticated request, and the `Authorization` header is still stripped from `ctx.req.headers` since that deletion is a logging-safety measure, not an authentication step. Strings deliberately do not prefix-match (`'/health'` never covers `'/healthz'`); use a RegExp for prefixes. `serverKitDefaultMiddleware` gains an optional second `options` parameter (`{ authentication?: AuthenticationMiddlewareOptions }`) to thread the whitelist through the canonical stack. Both additions are backwards compatible — calls without options behave exactly as before.
- 77cded6: The request-scoped container created by `serverKitContextMiddleware` is now disposed when the response closes. Previously it was never disposed at all — not a memory leak, since nothing long-lived held the scope, but any scoped service implementing `Symbol.dispose`/`Symbol.asyncDispose` was never deterministically released. Disposal is driven by the response's `close` event rather than by `next()` unwinding, so SSE and serverfeed streams (whose handlers return while the socket stays open) keep their scope alive until the socket actually ends; disposal errors are logged through the request logger rather than thrown, since the response is already gone. Two things to be aware of: nothing in ServerKit itself registers a disposable scoped service today, so this is enabling infrastructure for apps that do; and code that stashes `ctx.container` and resolves from it after the response has closed now throws "Cannot resolve from a disposed container" — that was always a lifecycle bug, and it is now a loud one. Resolve dependencies before responding.
- ba5e1f0: New `sendJson(ctx, serialized, status?)` helper for writing a pre-serialized JSON string as the response body. Koa infers `text/plain` for a string body unless a content type was set explicitly, so assigning compiled-serializer output to `ctx.body` directly ships the wrong content type — this helper sets `application/json` before the body and defaults the status to 200. It pairs with `compileSerializer` from `@maroonedsoftware/zod/serializer`, whose output skips Koa's own `JSON.stringify` pass entirely, but any pre-serialized JSON string works.

### Patch Changes

- Updated dependencies [8557da7]
  - @maroonedsoftware/policies@0.6.8
  - @maroonedsoftware/authentication@4.30.9

## 3.0.11

### Patch Changes

- 7587006: Update runtime dependency ranges across the workspace (injectkit ^1.7.1, zod ^4.5.4, deepmerge-ts ^8, raw-body ^4, qs ^6.16, kysely ^0.29.5, pg ^8.23, @modelcontextprotocol/sdk ^1.30, @fastify/busboy ^3.2.2, and related minors).
- Updated dependencies [7587006]
- Updated dependencies [7587006]
  - @maroonedsoftware/appconfig@2.6.0
  - @maroonedsoftware/authentication@4.30.8
  - @maroonedsoftware/logger@1.1.9
  - @maroonedsoftware/multipart@1.3.7
  - @maroonedsoftware/policies@0.6.7
  - @maroonedsoftware/serverfeed@0.1.6

## 3.0.10

### Patch Changes

- Updated dependencies [e2e968d]
  - @maroonedsoftware/errors@1.9.0
  - @maroonedsoftware/appconfig@2.5.1
  - @maroonedsoftware/authentication@4.30.7
  - @maroonedsoftware/multipart@1.3.6
  - @maroonedsoftware/policies@0.6.6

## 3.0.9

### Patch Changes

- Updated dependencies [3ce5586]
  - @maroonedsoftware/appconfig@2.5.0

## 3.0.8

### Patch Changes

- be035ce: Ship the MIT LICENSE file in the published package tarball, and link to it from the README.
- Updated dependencies [be035ce]
  - @maroonedsoftware/appconfig@2.4.6
  - @maroonedsoftware/authentication@4.30.6
  - @maroonedsoftware/errors@1.8.5
  - @maroonedsoftware/logger@1.1.8
  - @maroonedsoftware/multipart@1.3.5
  - @maroonedsoftware/policies@0.6.5
  - @maroonedsoftware/serverfeed@0.1.5
  - @maroonedsoftware/utilities@1.11.5

## 3.0.7

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/appconfig@2.4.5
  - @maroonedsoftware/authentication@4.30.5
  - @maroonedsoftware/errors@1.8.4
  - @maroonedsoftware/logger@1.1.7
  - @maroonedsoftware/multipart@1.3.4
  - @maroonedsoftware/policies@0.6.4
  - @maroonedsoftware/serverfeed@0.1.4
  - @maroonedsoftware/utilities@1.11.4

## 3.0.6

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/appconfig@2.4.4
  - @maroonedsoftware/authentication@4.30.4
  - @maroonedsoftware/errors@1.8.3
  - @maroonedsoftware/logger@1.1.6
  - @maroonedsoftware/multipart@1.3.3
  - @maroonedsoftware/policies@0.6.3
  - @maroonedsoftware/serverfeed@0.1.3
  - @maroonedsoftware/utilities@1.11.3

## 3.0.5

### Patch Changes

- 680557c: Run module `shutdown` hooks in reverse registration order, so a module tears down before the modules it depends on.
- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/appconfig@2.4.3
  - @maroonedsoftware/authentication@4.30.3
  - @maroonedsoftware/errors@1.8.2
  - @maroonedsoftware/logger@1.1.5
  - @maroonedsoftware/multipart@1.3.2
  - @maroonedsoftware/policies@0.6.2
  - @maroonedsoftware/serverfeed@0.1.2
  - @maroonedsoftware/utilities@1.11.2

## 3.0.4

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/appconfig@2.4.2
  - @maroonedsoftware/authentication@4.30.2
  - @maroonedsoftware/errors@1.8.1
  - @maroonedsoftware/logger@1.1.4
  - @maroonedsoftware/multipart@1.3.1
  - @maroonedsoftware/policies@0.6.1
  - @maroonedsoftware/serverfeed@0.1.1
  - @maroonedsoftware/utilities@1.11.1

## 3.0.3

### Patch Changes

- Updated dependencies [7501d83]
  - @maroonedsoftware/appconfig@2.4.1

## 3.0.2

### Patch Changes

- Updated dependencies [6568f36]
  - @maroonedsoftware/appconfig@2.4.0

## 3.0.1

### Patch Changes

- Updated dependencies [b7e1163]
  - @maroonedsoftware/policies@0.6.0
  - @maroonedsoftware/authentication@4.30.1

## 3.0.0

### Minor Changes

- 5e72484: Add `@maroonedsoftware/serverfeed`: a framework-agnostic, transport-free in-process feed of realtime server activity. Publish structured progress/status/log/error/heartbeat events, subscribe with an AND-semantics filter on source, correlation id, minimum level, and kind, and let a reconnecting client catch up from a bounded replay buffer by `Last-Event-ID` (with a `gap` flag when its resume point predates the buffer) or re-seed from a latest-per-key snapshot. An optional `./logger` subpath ships `ServerFeedLogger`, which mirrors qualifying log lines onto the bus.

  `@maroonedsoftware/koa` gains the Server-Sent Events transport that serves it, plus a lifecycle to keep long-lived streams from blocking shutdown:

  - `openSseStream(ctx, options?)` holds an SSE connection open on a Koa context, taking over the raw socket so a client disconnect is not logged as `ERR_STREAM_PREMATURE_CLOSE`. Heartbeats keep the socket and any intermediary proxy warm, and backpressure is tolerated while the socket drains — a client is dropped only once its unflushed buffer passes `maxBufferedBytes` (default 1 MB), so it reconnects and resumes rather than ballooning server memory. `frameEvent` / `frameComment` / `resolveLastEventId` are exported for framing and resume parsing.
  - A new `./serverfeed` subpath serves a `ServerFeed` bus over that transport via `serverFeedRouter()` / `handleServerFeed()`, replaying the backlog from the client's resume point and emitting a `resync` event when that point is too old. `@maroonedsoftware/serverfeed` is an optional peer dependency, needed only for this subpath.
  - `ServerKitModule` gains a `ready` hook that runs after the server reports ready, so background work (pollers, schedulers, cache warms, outbound connections) no longer delays boot; `start` stays for wiring that must exist before the first request. Both hooks now receive an `AbortSignal` that aborts when shutdown begins, also exposed as `builder.lifecycleSignal` for wiring into SSE streams. `builder.whenReady()` resolves once the ready phase finishes.
  - `builder.start(port, options?)` accepts `shutdownGraceMs` (default 10s). `SIGINT`/`SIGTERM` now closes idle connections immediately and force-closes the rest after the grace period, so a long-lived SSE stream or idle keep-alive socket can no longer hold `server.close()` open indefinitely. `shutdown` is idempotent and waits a bounded period for an in-flight `ready` hook to unwind first.

  Existing `start(container)` hooks and `start(port)` calls keep working unchanged.

### Patch Changes

- Updated dependencies [5e72484]
  - @maroonedsoftware/serverfeed@0.1.0

## 2.8.2

### Patch Changes

- Updated dependencies [6327141]
  - @maroonedsoftware/appconfig@2.3.0

## 2.8.1

### Patch Changes

- Updated dependencies [c8b0db5]
  - @maroonedsoftware/authentication@4.30.0

## 2.8.0

### Minor Changes

- df1a520: Add `ServerKitRouterType`, the router instance type returned by `ServerKitRouter`, so routers can be typed without importing `@koa/router` directly. `ServerKitServerBuilder.setupRoutes` now accepts `ServerKitRouterType[]`.

## 2.7.1

### Patch Changes

- dc2a24b: Constrain `ServerKitModule<ConfigT>` so `ConfigT` must extend `AppConfig`, ensuring the config passed to `setup` is always usable as an `AppConfig`.

## 2.7.0

### Minor Changes

- de7fef3: **Breaking (koa):** the parsed request body is now assigned to `ctx.parsedBody` instead of `ctx.body`.

  In Koa, `ctx.body` is the _response_ body. Writing the parsed request payload there caused it to be echoed back to the client on any handler path that returned without overwriting `ctx.body` (e.g. an early return, a 204, or a validate-then-fall-through). `bodyParserMiddleware` now writes the parsed value to the new `ctx.parsedBody` field (raw bytes remain on `ctx.rawBody`), leaving `ctx.body` solely for the response.

  Migration: read request input from `ctx.parsedBody` instead of `ctx.body` in route handlers:

  ```diff
  - const body = ctx.body as CreateUserDto;
  + const body = ctx.parsedBody as CreateUserDto;
  ```

  `scim`: the internal `takeRequestBody` helper now reads `ctx.parsedBody`; no public API change.

- f83e58e: **Breaking (koa):** `ServerKitServerBuilder` lifecycle signatures changed.

  - `setup()` now resolves to the built DI `Container` instead of the builder. Keep a reference to the builder for chaining rather than chaining off `setup()`:

    ```diff
    - const builder = await new ServerKitServerBuilder().setup(config, logger, modules);
    + const builder = new ServerKitServerBuilder();
    + await builder.setup(config, logger, modules); // returns the built container
    ```

  - `setupRoutes()` now takes `Router[]` and mounts each router's `routes()` and `allowedMethods()`, instead of taking pre-built middleware:

    ```diff
    - builder.setupRoutes([router.routes(), router.allowedMethods()]);
    + builder.setupRoutes([router]);
    ```

### Patch Changes

- @maroonedsoftware/authentication@4.29.1

## 2.6.0

### Minor Changes

- dfe5304: Security and robustness hardening across the workspace.

  - **appconfig**: reject `__proto__`/`constructor`/`prototype` key segments in `nestKeys` (prototype-pollution guard), isolate config-change listener errors so one throwing listener can't abort a reload, replace arrays on deep-merge (last-wins) instead of concatenating, and make secret/env resolver prefixes non-greedy and always global.
  - **authentication**: atomically claim the refresh-token `jti` (via the new `CacheProvider.add`) to close a refresh-reuse race, pin JWT verification to `RS256`, bound failed OTP/code attempts on the authenticator/email/phone factors (new `maxValidationAttempts`/`maxVerificationAttempts` options, HTTP 429 when exceeded), and split Basic credentials on the first colon only.
  - **cache**: add `CacheProvider.add` (atomic set-if-absent claim primitive) and make `update` apply `XX` so an expired key is not resurrected without a TTL.
  - **discord/slack/telegram/whatsapp**: add a per-request `requestTimeoutMs` (default 10s), redact secret tokens from REST-client logs, and neutralize `@everyone`/`@here`/broadcast mentions in outgoing text. Discord additionally acks multi-reply interactions out of band.
  - **koa**: reject `origin: '*'` combined with `credentials: true`, honor an inbound `X-Request-Id`, bound the binary parser body (new `BinaryParserOptions`, 20MB default, HTTP 413), and resolve wildcard media-type registrations (e.g. `application/*+json`).
  - **multipart**: bound field/parts counts by default (`MAX_FIELDS`/`MAX_PARTS`) so a field flood cannot exhaust memory.
  - **errors**: map Postgres foreign-key violations (23503) to HTTP 409 Conflict instead of 404.
  - **scim**: enforce `userName` required and unique on user PATCH (400/409).
  - **permissions-dsl**: reject reserved namespace names (JS keywords, permission builders, the `model` export) that would otherwise generate uncompilable output.
  - **utilities**: accept UUID versions 6/7/8 in `isUuid`.
  - **storage**: write files atomically (temp file + rename) so a mid-write crash can't leave a truncated file readable as complete.
  - **jobbroker**: reject the pg-boss work handler when a job in the batch fails so retry/dead-letter policies actually apply.
  - **johnny5**: strip dotenv inline comments on unquoted values without corrupting quoted ones.
  - **zod**: fall back to a stable message for issue codes that carry none.

### Patch Changes

- Updated dependencies [dfe5304]
- Updated dependencies [dfe5304]
  - @maroonedsoftware/logger@1.1.3
  - @maroonedsoftware/policies@0.5.3
  - @maroonedsoftware/appconfig@2.2.0
  - @maroonedsoftware/authentication@4.29.0
  - @maroonedsoftware/errors@1.8.0
  - @maroonedsoftware/multipart@1.3.0
  - @maroonedsoftware/utilities@1.11.0

## 2.5.1

### Patch Changes

- Updated dependencies [b00d9b4]
  - @maroonedsoftware/errors@1.7.1
  - @maroonedsoftware/appconfig@2.1.2
  - @maroonedsoftware/authentication@4.28.3
  - @maroonedsoftware/multipart@1.2.2
  - @maroonedsoftware/policies@0.5.2

## 2.5.0

### Minor Changes

- b759188: Add `ServerKitServerBuilder`, a fluent builder that wires an injectkit container, body parsers, middleware, and routes and runs the module `setup`/`start`/`shutdown` lifecycle around a Koa server. Add `serverKitDefaultMiddleware` (error → context → optional rate limiter → CORS → authentication) and a `RateLimiter` DI token that the default stack applies automatically when one is registered.

  Expand `defaultParserMappings` to cover binary content types (`application/octet-stream`, `application/pdf`, `application/zip`, `application/gzip`) and to attach per-parser options, with the JSON parsers now wired to `bigIntReviver` so numeric-string bigints round-trip. Each mapping value is now a `ServerKitParserMapping` (`{ parser, options? }`) rather than a bare parser class; consumers that read `defaultParserMappings` directly should access `.parser`.

### Patch Changes

- Updated dependencies [b759188]
  - @maroonedsoftware/appconfig@2.1.1
  - @maroonedsoftware/authentication@4.28.2
  - @maroonedsoftware/logger@1.1.2
  - @maroonedsoftware/policies@0.5.1

## 2.4.5

### Patch Changes

- Updated dependencies [af20061]
  - @maroonedsoftware/appconfig@2.1.0
  - @maroonedsoftware/authentication@4.28.1

## 2.4.4

### Patch Changes

- Updated dependencies [bae9e10]
  - @maroonedsoftware/appconfig@2.0.0

## 2.4.3

### Patch Changes

- Updated dependencies [c8f0fa4]
  - @maroonedsoftware/appconfig@1.9.0

## 2.4.2

### Patch Changes

- Updated dependencies [75e4ce2]
  - @maroonedsoftware/appconfig@1.8.1

## 2.4.1

### Patch Changes

- Updated dependencies [54af043]
  - @maroonedsoftware/appconfig@1.8.0

## 2.4.0

### Minor Changes

- 950477d: `requireSignature` now takes an optional options object as its second argument instead of a positional policy name: `requireSignature(optionsKey, { policy })`. Adds the `RequireSignatureOptions` type. Update call sites passing a policy name positionally — e.g. `requireSignature('slack', SLACK_SIGNATURE_POLICY)` becomes `requireSignature('slack', { policy: SLACK_SIGNATURE_POLICY })`.

## 2.3.0

### Minor Changes

- 3422e87: `requireSignature` now verifies the request HMAC through the new `request.signature.valid` policy (`DefaultSignaturePolicy`) resolved via `PolicyService`, instead of computing the comparison inline — mirroring how `requirePolicy` is backed by `DefaultMfaSatisfiedPolicy`. The middleware, its `requireSignature(optionsKey)` signature, `SignatureOptions`, and the 401-on-mismatch behaviour are unchanged.

  The verification rule is now swappable: subclass `DefaultSignaturePolicy` and re-register it under `REQUIRE_SIGNATURE_POLICY` to change the behaviour (e.g. accept a rotated secret during a key rollover) without touching the middleware. The policy receives `SignaturePolicyContext<TOptions>` — the raw body, a case-insensitive `getHeader` accessor, and the resolved options — so a custom rule can read whichever header(s) its scheme needs rather than a single pre-extracted signature. The context (and `requireSignature<TOptions>(optionsKey)`) are generic over the options shape, defaulting to `SignatureOptions`; a custom policy can declare a richer config (e.g. a Slack signing secret plus a replay window) and be driven through the same middleware.

  `requireSignature(optionsKey, policy?)` now takes an optional policy name (defaulting to `REQUIRE_SIGNATURE_POLICY`), so a different registered policy can verify a different scheme through the same middleware — e.g. `SLACK_SIGNATURE_POLICY` from `@maroonedsoftware/slack`.

  **Action required:** register the policy in your `PolicyRegistryMap` (`registry.set(REQUIRE_SIGNATURE_POLICY, DefaultSignaturePolicy)`). Routes using `requireSignature` will otherwise fail to resolve the policy at request time.

### Patch Changes

- 3422e87: Replace native JS `Date` with Luxon `DateTime` throughout, per the repo's date/time convention. Native `Date` now appears only at true interop boundaries (e.g. converting a third-party adapter's `Date` with `DateTime.fromJSDate`).

  **Breaking — `@maroonedsoftware/authentication`:** OAuth 2.0 / OIDC token and factor types now use `DateTime` instead of `Date`:
  - `OAuth2Tokens.expiresAt` is now `DateTime | undefined`. Adapters implementing `OAuth2ProviderClient` must convert at the boundary — e.g. `DateTime.fromJSDate(arcticTokens.accessTokenExpiresAt())`.
  - `OAuth2FactorValue.refreshTokenExpiresAt`, `OidcFactorValue.refreshTokenExpiresAt`, and the `updateRefreshToken(...)` `refreshTokenExpiresAt` argument are now `DateTime` (optional; omit for a non-expiring refresh token, where the type was previously `Date | null`). Repository implementations that persist to a `timestamptz` column should call `.toJSDate()` on write and `DateTime.fromJSDate(...)` on read.
  - `OAuth2FactorService.refreshAccessToken(...)` now resolves `expiresAt?: DateTime` (was `Date | null`).

  **Breaking — `@maroonedsoftware/johnny5`:** `DaemonStatus.startedAt` is now a `DateTime` (was `Date`). The on-disk pid record is unchanged (still an ISO string).

  `@maroonedsoftware/encryption`, `@maroonedsoftware/koa`, and `@maroonedsoftware/slack` change only internal time computations (KMS decrypt-audit timestamp, rate-limit reset header, Slack signature default `now`); no public API change. `luxon` is added as a runtime dependency to `encryption`, `johnny5`, and `koa`.

- Updated dependencies [3422e87]
- Updated dependencies [3422e87]
  - @maroonedsoftware/authentication@4.28.0
  - @maroonedsoftware/policies@0.5.0

## 2.2.16

### Patch Changes

- Updated dependencies [1106274]
  - @maroonedsoftware/appconfig@1.7.0

## 2.2.15

### Patch Changes

- Updated dependencies [a0e9bd2]
- Updated dependencies [d5ccf3c]
  - @maroonedsoftware/appconfig@1.6.0
  - @maroonedsoftware/utilities@1.10.0
  - @maroonedsoftware/authentication@4.27.2

## 2.2.14

### Patch Changes

- Updated dependencies [7503069]
  - @maroonedsoftware/utilities@1.9.0
  - @maroonedsoftware/authentication@4.27.1

## 2.2.13

### Patch Changes

- Updated dependencies [de017e6]
  - @maroonedsoftware/authentication@4.27.0

## 2.2.12

### Patch Changes

- Updated dependencies [b9f1766]
  - @maroonedsoftware/authentication@4.26.0

## 2.2.11

### Patch Changes

- Updated dependencies [3459c07]
  - @maroonedsoftware/authentication@4.25.0

## 2.2.10

### Patch Changes

- Updated dependencies [700284a]
  - @maroonedsoftware/authentication@4.24.0

## 2.2.9

### Patch Changes

- Updated dependencies [cc1164e]
  - @maroonedsoftware/authentication@4.23.0

## 2.2.8

### Patch Changes

- Updated dependencies [09f3f3b]
  - @maroonedsoftware/authentication@4.22.2

## 2.2.7

### Patch Changes

- Updated dependencies [d494e15]
  - @maroonedsoftware/utilities@1.8.0
  - @maroonedsoftware/authentication@4.22.1

## 2.2.6

### Patch Changes

- Updated dependencies [7629ec6]
  - @maroonedsoftware/authentication@4.22.0

## 2.2.5

### Patch Changes

- a167ee3: Bump runtime dependencies (notably `injectkit` to 1.4.1) and relax the pgboss job registration type guard so it accepts the updated `Identifier` shape.
- Updated dependencies [a167ee3]
  - @maroonedsoftware/appconfig@1.5.1
  - @maroonedsoftware/authentication@4.21.2
  - @maroonedsoftware/logger@1.1.1
  - @maroonedsoftware/policies@0.4.2

## 2.2.4

### Patch Changes

- Updated dependencies [db65060]
  - @maroonedsoftware/authentication@4.21.1

## 2.2.3

### Patch Changes

- 108c1d4: Cross-package security and correctness audit.
  - **authentication**: `JwtAuthenticationIssuer.parse` now receives both the raw `token` and the decoded `payload` (was just `payload`) — implementations **must** verify the signature against trusted key material because the payload is unverified. `JwtProvider` accepts an optional `pemPublicKey` and now verifies tokens with the public key (derived from the private PEM when not supplied) so verification paths never have to hold the signing key. `updateSession` resets `expiresAt` to `now + expiration` (absolute) instead of stacking it on top of the existing expiry — a chatty client can no longer extend a session past its configured lifetime. FIDO assertion verification rejects factors that are missing their replay counter instead of silently degrading to "no counter check". Magic-link redirect HTML now embeds the URL via `JSON.stringify` so the assignment string cannot be escaped. Authorization-header parsing splits on the first space only, preserving multi-token credentials such as `Digest username="…", nonce="…"`.
  - **encryption**: `EncryptionProvider.createKey` is now `async` and derives keys with **Argon2id** (the OWASP-recommended memory-hard KDF, shared with `Argon2idPasswordHashProvider` via the new `ARGON2ID_DEFAULTS` export) instead of PBKDF2-HMAC-SHA512 at 65 535 iterations. Callers must `await` and any keys previously derived from a passphrase will no longer match — re-derive and re-encrypt. The per-id lock chain inside `InMemoryKmsProvider` was rewritten with `async`/`await`, fixing a `prev.then(fn, fn)` bug that broke serialisation when a queued operation rejected. Removed an unreachable `KeyRetiredError` guard on the encrypt path. `kms/in-memory.kms.provider.ts` renamed to `kms/in.memory.kms.provider.ts` to match the project's dot-separated filename convention — deep imports must update the path.
  - **errors**: The `@OnError` decorator now **rethrows** the original error after invoking the handler. Handlers that map errors continue to work (they throw their replacement, which short-circuits the rethrow); handlers that only logged and swallowed will start propagating errors. `isPostgresError` is stricter — it requires `code` to be a string in the 5-character SQLSTATE shape, so generic Node errors (`ENOENT`, axios errors with a `code`, etc.) are no longer mis-routed through the Postgres mapper.
  - **appconfig**: `AppConfigProviderGcpSecrets.getSecret` now throws a `ServerkitError` (with the original error attached as `cause` and `secretId` / `projectId` in `internalDetails`) when Secret Manager rejects, instead of silently substituting `''` and booting the service with empty passwords / API keys. `canParse` resets the regex's `lastIndex` before testing, fixing a stateful-`/g`-flag bug that returned `false` for matching strings on subsequent calls. `AppConfigBuilder.build()` now returns an empty config when no sources are registered instead of crashing on `deepmerge()` of zero arguments. Added a workspace dependency on `@maroonedsoftware/errors`.
  - **jobbroker**: `PgBossJobRunner` now `await`s `pgboss.work(...)` and wraps the per-batch job execution in `Promise.allSettled`, so pg-boss no longer marks a batch complete before the jobs have actually finished. Each job in a batch now resolves its own `Job` instance from the DI container, matching the documented "resolved for each execution" contract.
  - **koa**: `requireSignature` middleware compares HMAC digests with `crypto.timingSafeEqual` (with a length guard for missing/short signatures) instead of `!==`, removing a timing-attack vector on webhook signatures.
  - **scim**: `ScimUserService` and `ScimGroupService` use Luxon `DateTime.utc().toISO()` for `meta.created` / `meta.lastModified` instead of native `Date#toISOString()`, matching the project-wide Luxon convention.

- Updated dependencies [108c1d4]
  - @maroonedsoftware/authentication@4.21.0
  - @maroonedsoftware/errors@1.7.0
  - @maroonedsoftware/appconfig@1.5.0
  - @maroonedsoftware/multipart@1.2.1
  - @maroonedsoftware/policies@0.4.1

## 2.2.2

### Patch Changes

- Updated dependencies [7c85ab4]
- Updated dependencies [3ed349d]
  - @maroonedsoftware/multipart@1.2.0

## 2.2.1

### Patch Changes

- Updated dependencies [8232ee3]
  - @maroonedsoftware/authentication@4.20.0

## 2.2.0

### Minor Changes

- b506f37: Replace `requireSecurity` with a policy-driven `requirePolicy` middleware,
  and let policies attach HTTP headers to their denial results.

  ### `@maroonedsoftware/policies`
  - `PolicyResultDenied` gains an optional `headers?: Record<string, string>`
    field, forwarded to `HttpError.withHeaders` by `BasePolicyService.assert`.
  - `Policy.deny(...)` and `Policy.denyStepUp(...)` now return a
    `PolicyDenialBuilder` (still assignable to `PolicyResultDenied`) with a
    fluent `.withHeaders(headers)` setter:

    ```ts
    return this.deny('mfa_required').withHeaders({ 'WWW-Authenticate': 'Bearer error="mfa_required"' });
    ```

    Use for `WWW-Authenticate` on auth/MFA policies, `Retry-After` on
    rate-limit policies, etc.

  ### `@maroonedsoftware/authentication`
  - **New `DefaultMfaSatisfiedPolicy`** (`'auth.session.mfa.satisfied'`).
    Gate-style rule consulted by koa's new `requirePolicy()`: allows when the
    session has at least two factors and at least one is not of
    `kind: 'knowledge'`. Denies with
    `WWW-Authenticate: Bearer error="mfa_required"`. Distinct from
    `'auth.session.mfa.required'` — that policy answers "primary just
    succeeded, is a different secondary required?" during the orchestrator
    handoff; this one answers "is this session as-it-stands MFA-satisfied?"
    for route gating. Subclass to grant MFA credit to single-factor sessions
    whose underlying method delegates MFA elsewhere (e.g. `oidc` from an IdP
    that enforces 2FA upstream).
  - The existing default policies — `DefaultMfaRequiredPolicy`,
    `DefaultRecentFactorPolicy`, `DefaultAssuranceLevelPolicy` — now attach
    `WWW-Authenticate` headers on deny (`mfa_required`, `step_up_required`,
    `aal1_required` / `aal2_required` respectively) so SPAs can detect
    re-auth-required responses the same way they detect 401s.
  - `AuthenticationPolicyMappings` and `AuthenticationPolicyContexts` gain
    the new `'auth.session.mfa.satisfied'` entry.

  ### `@maroonedsoftware/koa`
  - **Breaking:** `requireSecurity` is removed.
  - **New `requirePolicy(options?)`** router middleware. Validates the
    session, then resolves `PolicyService` from `ctx.container` and calls
    `policyService.assert(options.policy ?? 'auth.session.mfa.satisfied', { session })`.
    Routes can opt into any registered policy by name (MFA, AAL2 step-up,
    recent-factor step-up, custom) without a codegen change. Pass
    `{ policy: false }` to validate the session only.
  - `@maroonedsoftware/policies` is now a direct dependency.

  #### Migration

  | Old                                      | New                                |
  | ---------------------------------------- | ---------------------------------- |
  | `requireSecurity({ requireMfa: true })`  | `requirePolicy()`                  |
  | `requireSecurity({ requireMfa: false })` | `requirePolicy({ policy: false })` |
  | `requireSecurity()` (default)            | `requirePolicy()`                  |

  Status code on MFA-denied requests changes from **401** to **403** (the
  policy framework's standard for "authenticated but not allowed"). The
  `WWW-Authenticate: Bearer error="mfa_required"` header is preserved on the
  new 403 so SPAs that gate re-auth on the header keep working.

  To grant MFA credit to OIDC sessions (or any single-factor session whose
  method delegates MFA upstream), register a custom policy at bootstrap:

  ```ts
  @Injectable()
  class OidcAwareMfaSatisfiedPolicy extends Policy<AuthMfaSatisfiedPolicyContext> {
    async evaluate({ session }) {
      if (session.factors.some(f => f.method === 'oidc')) return this.allow();
      if (session.factors.length >= 2 && !session.factors.every(f => f.kind === 'knowledge')) {
        return this.allow();
      }
      return this.deny('mfa_required').withHeaders({ 'WWW-Authenticate': 'Bearer error="mfa_required"' });
    }
  }

  registry.register(PolicyRegistryMap).useMap().add('auth.session.mfa.satisfied', OidcAwareMfaSatisfiedPolicy);
  ```

### Patch Changes

- Updated dependencies [b506f37]
  - @maroonedsoftware/policies@0.4.0
  - @maroonedsoftware/authentication@4.19.0

## 2.1.21

### Patch Changes

- @maroonedsoftware/authentication@4.18.1

## 2.1.20

### Patch Changes

- Updated dependencies [d84fc17]
  - @maroonedsoftware/authentication@4.18.0

## 2.1.19

### Patch Changes

- Updated dependencies [e840690]
- Updated dependencies [b6e5df2]
  - @maroonedsoftware/authentication@4.17.0

## 2.1.18

### Patch Changes

- Updated dependencies [0825138]
- Updated dependencies [2ec28e2]
- Updated dependencies [92b1420]
  - @maroonedsoftware/authentication@4.16.0

## 2.1.17

### Patch Changes

- Updated dependencies [54dbb7c]
  - @maroonedsoftware/authentication@4.15.0

## 2.1.16

### Patch Changes

- Updated dependencies [f8a0156]
  - @maroonedsoftware/authentication@4.14.0

## 2.1.15

### Patch Changes

- Updated dependencies [47c201a]
- Updated dependencies [4f12151]
  - @maroonedsoftware/authentication@4.13.0

## 2.1.14

### Patch Changes

- Updated dependencies [33fa7b0]
  - @maroonedsoftware/authentication@4.12.0

## 2.1.13

### Patch Changes

- Updated dependencies [630b492]
  - @maroonedsoftware/authentication@4.11.0

## 2.1.12

### Patch Changes

- Updated dependencies [058fe78]
  - @maroonedsoftware/authentication@4.10.0

## 2.1.11

### Patch Changes

- Updated dependencies [e3f1419]
  - @maroonedsoftware/authentication@4.9.0

## 2.1.10

### Patch Changes

- Updated dependencies [2502e3d]
- Updated dependencies [915681d]
  - @maroonedsoftware/authentication@4.8.0

## 2.1.9

### Patch Changes

- Updated dependencies [42a3ee3]
  - @maroonedsoftware/authentication@4.7.0

## 2.1.8

### Patch Changes

- Updated dependencies [af5cb70]
  - @maroonedsoftware/authentication@4.6.0

## 2.1.7

### Patch Changes

- @maroonedsoftware/authentication@4.5.1

## 2.1.6

### Patch Changes

- Updated dependencies [87792a2]
  - @maroonedsoftware/authentication@4.5.0

## 2.1.5

### Patch Changes

- @maroonedsoftware/authentication@4.4.1

## 2.1.4

### Patch Changes

- Updated dependencies [82bac7f]
  - @maroonedsoftware/authentication@4.4.0

## 2.1.3

### Patch Changes

- Updated dependencies [b82c093]
  - @maroonedsoftware/authentication@4.3.0

## 2.1.2

### Patch Changes

- Updated dependencies [b2fbd4f]
- Updated dependencies [1cea32d]
  - @maroonedsoftware/authentication@4.2.0

## 2.1.1

### Patch Changes

- Updated dependencies [164a27e]
  - @maroonedsoftware/authentication@4.1.0

## 2.1.0

### Minor Changes

- 81d4e02: `requireSecurity` now enforces multi-factor authentication by default. Routes guarded by `requireSecurity()` will throw 401 with `WWW-Authenticate: Bearer error="mfa_required"` unless the session has at least two factors and at least one factor is not of `kind: 'knowledge'`. Pass `requireSecurity({ requireMfa: false })` to opt out (e.g. for step-up MFA enrollment routes). The previously-reserved `roles` option has been removed.

## 2.0.0

### Major Changes

- 24450df: Rename `AuthenticationContext` to `AuthenticationSession`, drop the legacy `actorId` / `actorType` / `roles` shape, and consolidate the type export point.

  Breaking changes:
  - `AuthenticationContext` → `AuthenticationSession`. The interface fields are now `subject` (replaces `actorId` / `actorType`), `sessionToken`, `issuedAt`, `lastAccessedAt`, `expiresAt`, `factors`, and `claims`.
  - `invalidAuthenticationContext` → `invalidAuthenticationSession`.
  - `AuthenticationFactor` → `AuthenticationSessionFactor`. Each factor now carries `methodId`, `issuedAt`, and `authenticatedAt`; the old `lastAuthenticated` field is renamed to `authenticatedAt`. `method` is now typed as `AuthenticationFactorMethod` (`'phone' | 'password' | 'authenticator' | 'email' | 'fido'`).
  - `roles` has been removed from the session shape. `requireSecurity` no longer enforces role membership and only checks that an authenticated session is present; the `roles` option on `SecurityOptions` is reserved for future use but currently inert.
  - `ctx.authenticationContext` on `ServerKitContext` (from `@maroonedsoftware/koa`) → `ctx.authenticationSession`.
  - The `authentication.context.ts` module has been removed; its exports now live in `types.ts`. Existing top-level imports from `@maroonedsoftware/authentication` continue to work under the new names.

  Migration: rename `AuthenticationContext` → `AuthenticationSession`, `invalidAuthenticationContext` → `invalidAuthenticationSession`, `ctx.authenticationContext` → `ctx.authenticationSession`. Replace `actorId` / `actorType` with `subject` and remove any reads of `roles` from sessions; if you depended on `requireSecurity({ roles })` for authorization, gate routes on session claims instead until the role check is reintroduced.

### Patch Changes

- Updated dependencies [24450df]
  - @maroonedsoftware/authentication@4.0.0

## 1.17.10

### Patch Changes

- Updated dependencies [2620573]
  - @maroonedsoftware/authentication@3.0.0

## 1.17.9

### Patch Changes

- Updated dependencies [5bb6817]
  - @maroonedsoftware/authentication@2.3.0

## 1.17.8

### Patch Changes

- 9e2c2de: chore: update package versions for dependencies and devDependencies
- Updated dependencies [9e2c2de]
  - @maroonedsoftware/authentication@2.2.1
  - @maroonedsoftware/appconfig@1.4.1
  - @maroonedsoftware/errors@1.6.0
  - @maroonedsoftware/logger@1.1.0
  - @maroonedsoftware/multipart@1.1.2
  - @maroonedsoftware/utilities@1.7.0

## 1.17.7

### Patch Changes

- Updated dependencies [e57e48a]
  - @maroonedsoftware/authentication@2.2.0

## 1.17.6

### Patch Changes

- Updated dependencies [ea5521d]
  - @maroonedsoftware/authentication@2.1.0

## 1.17.5

### Patch Changes

- Updated dependencies [0ca3ef5]
  - @maroonedsoftware/authentication@2.0.0

## 1.17.4

### Patch Changes

- Updated dependencies [8802197]
  - @maroonedsoftware/authentication@1.1.0

## 1.17.3

### Patch Changes

- Updated dependencies [0a3a7d5]
- Updated dependencies [bf8f78e]
  - @maroonedsoftware/authentication@1.0.0

## 1.17.2

### Patch Changes

- Updated dependencies [afaa0af]
  - @maroonedsoftware/authentication@0.23.0

## 1.17.1

### Patch Changes

- Updated dependencies [f7eaa33]
- Updated dependencies [f7eaa33]
  - @maroonedsoftware/authentication@0.22.0

## 1.17.0

### Minor Changes

- 65e60f5: Expose `ServerKitContext` as an injectkit token. `serverKitContextMiddleware` now registers the live Koa context against it in the request-scoped container, so request-scoped services can declare `ServerKitContext` as a constructor dependency.

## 1.16.6

### Patch Changes

- Updated dependencies [28b3a92]
  - @maroonedsoftware/authentication@0.21.0

## 1.16.5

### Patch Changes

- Updated dependencies [951a245]
  - @maroonedsoftware/authentication@0.20.0

## 1.16.4

### Patch Changes

- Updated dependencies [fab17af]
  - @maroonedsoftware/authentication@0.19.0

## 1.16.3

### Patch Changes

- Updated dependencies [c81ebcb]
  - @maroonedsoftware/authentication@0.18.0

## 1.16.2

### Patch Changes

- Updated dependencies [82ce3aa]
  - @maroonedsoftware/authentication@0.17.0

## 1.16.1

### Patch Changes

- Updated dependencies [e111278]
  - @maroonedsoftware/authentication@0.16.0

## 1.16.0

### Minor Changes

- 69ef4b3: feat: enhance error handling in errorMiddleware to support ServerkitError
  - Updated errorMiddleware to handle ServerkitError, returning a 500 status with message and details.
  - Added unit tests for ServerkitError handling, including cases for bare errors, subclass errors, and preference for HttpError.
  - Improved error response structure for better clarity in error handling.

### Patch Changes

- Updated dependencies [7624166]
- Updated dependencies [1d79133]
  - @maroonedsoftware/errors@1.6.0
  - @maroonedsoftware/authentication@0.15.0
  - @maroonedsoftware/multipart@1.1.2

## 1.15.6

### Patch Changes

- @maroonedsoftware/authentication@0.14.1

## 1.15.5

### Patch Changes

- Updated dependencies [5151eac]
  - @maroonedsoftware/authentication@0.14.0

## 1.15.4

### Patch Changes

- Updated dependencies [b07bec3]
  - @maroonedsoftware/authentication@0.13.0

## 1.15.3

### Patch Changes

- Updated dependencies [f988d31]
  - @maroonedsoftware/authentication@0.12.0

## 1.15.2

### Patch Changes

- Updated dependencies [bc92b8e]
- Updated dependencies [ef3b5b1]
  - @maroonedsoftware/authentication@0.11.0

## 1.15.1

### Patch Changes

- Updated dependencies [d1270bb]
  - @maroonedsoftware/authentication@0.10.0

## 1.15.0

### Minor Changes

- 4e9ccf4: Update error handling and type overrides
  - Updated Kysely type overrides to include custom parsers for `INTERVAL` and `TINTERVAL`, improving PostgreSQL type handling.
  - Renamed `withErrors(errors)` to `withDetails(details)` in the errors package documentation for clarity.
  - Added a class decorator `OnPostgresError` to automatically map PostgreSQL errors to HTTP errors, enhancing error handling in services.
  - Enhanced tests for Kysely type overrides to cover new interval parsing functionality.
  - Added documentation for E.164 international phone number format in the utilities package.

### Patch Changes

- Updated dependencies [4e9ccf4]
  - @maroonedsoftware/utilities@1.7.0
  - @maroonedsoftware/errors@1.5.0
  - @maroonedsoftware/authentication@0.9.1
  - @maroonedsoftware/multipart@1.1.1

## 1.14.1

### Patch Changes

- Updated dependencies [60870fc]
  - @maroonedsoftware/authentication@0.9.0

## 1.14.0

### Minor Changes

- 687c984: Implement cache provider for authentication services
  - Introduced a new `@maroonedsoftware/cache` package with a `CacheProvider` interface and an `IoRedisCacheProvider` implementation using ioredis.
  - Updated authentication services to utilize the new cache provider, replacing direct cache provider imports with the new package.
  - Removed the old cache provider implementation from the authentication package.
  - Added tests for the new cache provider to ensure functionality and reliability.
  - Updated README and documentation for the cache package to guide usage and implementation.

### Patch Changes

- Updated dependencies [687c984]
  - @maroonedsoftware/authentication@0.8.0
  - @maroonedsoftware/utilities@1.6.0

## 1.13.5

### Patch Changes

- Updated dependencies [f9aa6d6]
  - @maroonedsoftware/authentication@0.7.0

## 1.13.4

### Patch Changes

- Updated dependencies [7b70566]
  - @maroonedsoftware/authentication@0.6.0

## 1.13.3

### Patch Changes

- Updated dependencies [5c4756a]
- Updated dependencies [79fde38]
  - @maroonedsoftware/utilities@1.5.0
  - @maroonedsoftware/authentication@0.5.0

## 1.13.2

### Patch Changes

- Updated dependencies [66949c3]
  - @maroonedsoftware/authentication@0.4.0

## 1.13.1

### Patch Changes

- Updated dependencies [6fe8bc4]
  - @maroonedsoftware/authentication@0.3.0

## 1.13.0

### Minor Changes

- beef958: Expose client ipAddress on ServerKitContext and adjust middleware to: read user-agent via ctx.get (no default), set ipAddress from ctx.ip, read X-Correlation-Id from ctx.headers (handling array values) and always generate a new requestId (instead of honoring an incoming header). Update response headers accordingly.

## 1.12.0

### Minor Changes

- 320673a: Normalize response header names to lowercase in the rate limiter middleware. The middleware now emits 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', and 'x-ratelimit-reset' instead of their PascalCase equivalents; no functional behavior changes to rate limiting logic.

## 1.11.0

### Minor Changes

- 5004488: adding optional name to serverkit module

## 1.10.2

### Patch Changes

- Updated dependencies [b1005f4]
  - @maroonedsoftware/utilities@1.4.0

## 1.10.1

### Patch Changes

- Updated dependencies [b9940cc]
  - @maroonedsoftware/utilities@1.3.0

## 1.10.0

### Minor Changes

- fff5f18: added rate limit headers

## 1.9.0

### Minor Changes

- 922f585: upgrading to typescript 6

### Patch Changes

- Updated dependencies [922f585]
  - @maroonedsoftware/authentication@0.2.0
  - @maroonedsoftware/appconfig@1.4.0
  - @maroonedsoftware/multipart@1.1.0
  - @maroonedsoftware/utilities@1.2.0
  - @maroonedsoftware/errors@1.4.0
  - @maroonedsoftware/logger@1.1.0

## 1.8.0

### Minor Changes

- 97d5ffc: adding serverkit module

## 1.7.0

### Minor Changes

- 42973b6: update requireSecurity options role to be string array

## 1.6.2

### Patch Changes

- Updated dependencies [64fdc6c]
  - @maroonedsoftware/appconfig@1.3.0

## 1.6.0

### Minor Changes

- 5ded700: adding require signature middleware

### Patch Changes

- Updated dependencies [5ded700]
- Updated dependencies [5ded700]
  - @maroonedsoftware/errors@1.3.0
  - @maroonedsoftware/appconfig@1.2.0
  - @maroonedsoftware/multipart@1.0.3

## 1.5.0

### Minor Changes

- e5dc109: adding router security middleware

### Patch Changes

- Updated dependencies [e5dc109]
  - @maroonedsoftware/authentication@0.1.0

## 1.4.0

### Minor Changes

- 75d121c: fix auth middleware bug

## 1.3.0

### Minor Changes

- fe1ea8f: updating how body parsers work

## 1.2.0

### Minor Changes

- dc9e6d1: update packages
- 337289b: adding authentication package and middleware, this is mostly stubs to prep for future work

### Patch Changes

- Updated dependencies [0eea499]
  - @maroonedsoftware/utilities@1.1.0
  - @maroonedsoftware/authentication@0.0.0
  - @maroonedsoftware/errors@1.2.0
  - @maroonedsoftware/logger@1.0.0
  - @maroonedsoftware/multipart@1.0.2

## 1.1.1

### Patch Changes

- Updated dependencies [3f636dd]
  - @maroonedsoftware/errors@1.2.0
  - @maroonedsoftware/multipart@1.0.2

## 1.1.0

### Minor Changes

- 8fe2ab5: added cors, rate limit, and context middleware
  removed injectkit middleware as it's superseded by context

### Patch Changes

- Updated dependencies [8ab564a]
  - @maroonedsoftware/errors@1.1.0
  - @maroonedsoftware/multipart@1.0.1

## 1.0.0

### Major Changes

- fd930ff: adding koa package with types and middleware
