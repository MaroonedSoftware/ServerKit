# @maroonedsoftware/slack

## 3.1.2

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

## 3.1.1

### Patch Changes

- Updated dependencies [8557da7]
  - @maroonedsoftware/policies@0.6.8

## 3.1.0

### Minor Changes

- 7587006: Move to @slack/web-api v8 (slack) and execa v10 (johnny5). Both SDKs' types appear in the public API — `SlackClient`'s argument/response types and `Shell`'s `ShellOptions`/`ResultPromise` — so consumers typed against the old SDK shapes may need to update; `ShellOptions` is now a type alias rather than an interface.

### Patch Changes

- 7587006: Update runtime dependency ranges across the workspace (injectkit ^1.7.1, zod ^4.5.4, deepmerge-ts ^8, raw-body ^4, qs ^6.16, kysely ^0.29.5, pg ^8.23, @modelcontextprotocol/sdk ^1.30, @fastify/busboy ^3.2.2, and related minors).
- Updated dependencies [7587006]
- Updated dependencies [7587006]
  - @maroonedsoftware/cache@0.5.0
  - @maroonedsoftware/comms@0.2.10
  - @maroonedsoftware/logger@1.1.9
  - @maroonedsoftware/policies@0.6.7

## 3.0.7

### Patch Changes

- Updated dependencies [e2e968d]
  - @maroonedsoftware/errors@1.9.0
  - @maroonedsoftware/comms@0.2.9
  - @maroonedsoftware/policies@0.6.6

## 3.0.6

### Patch Changes

- be035ce: Ship the MIT LICENSE file in the published package tarball, and link to it from the README.
- Updated dependencies [be035ce]
  - @maroonedsoftware/cache@0.4.5
  - @maroonedsoftware/comms@0.2.8
  - @maroonedsoftware/errors@1.8.5
  - @maroonedsoftware/logger@1.1.8
  - @maroonedsoftware/policies@0.6.5

## 3.0.5

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/cache@0.4.4
  - @maroonedsoftware/comms@0.2.7
  - @maroonedsoftware/errors@1.8.4
  - @maroonedsoftware/logger@1.1.7
  - @maroonedsoftware/policies@0.6.4

## 3.0.4

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/cache@0.4.3
  - @maroonedsoftware/comms@0.2.6
  - @maroonedsoftware/errors@1.8.3
  - @maroonedsoftware/logger@1.1.6
  - @maroonedsoftware/policies@0.6.3

## 3.0.3

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/cache@0.4.2
  - @maroonedsoftware/comms@0.2.5
  - @maroonedsoftware/errors@1.8.2
  - @maroonedsoftware/logger@1.1.5
  - @maroonedsoftware/policies@0.6.2

## 3.0.2

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
  - @maroonedsoftware/comms@0.2.4
  - @maroonedsoftware/errors@1.8.1
  - @maroonedsoftware/logger@1.1.4
  - @maroonedsoftware/policies@0.6.1

## 3.0.1

### Patch Changes

- Updated dependencies [b7e1163]
  - @maroonedsoftware/policies@0.6.0

## 3.0.0

### Minor Changes

- de7fef3: Add opt-in webhook de-duplication for at-least-once delivery.

  - **cache**: new `IdempotencyStore` abstraction and default `CacheIdempotencyStore` (backed by the atomic `CacheProvider.add` claim primitive). `deduplicate(key, work, options?)` runs `work` at most once per key across processes, returning `processed` / `duplicate` / `dropped`. It uses an in-flight claim (`inFlightTtl`), a configurable retention window (`retentionTtl`), and a poison-event attempt cap (`maxAttempts`) so a permanently-failing event is dead-lettered rather than reprocessed forever.
  - **slack / discord / telegram / whatsapp**: each dispatch method now accepts an optional trailing `{ idempotency }` argument and exports a per-platform key helper — `slackEventIdempotencyKey`, `discordInteractionIdempotencyKey`, `telegramUpdateIdempotencyKey`, and `whatsappMessageIdempotencyKey` / `whatsappStatusIdempotencyKey`. De-duplication is fully opt-in: when no store is passed, behavior is byte-for-byte unchanged. `@maroonedsoftware/cache` is declared as an optional peer dependency (type-only import, no runtime dependency when unused). See each package README for the recommended durable enqueue-and-ack pattern and the edge de-dup one-liner.

### Patch Changes

- Updated dependencies [de7fef3]
  - @maroonedsoftware/cache@0.4.0

## 2.1.0

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
  - @maroonedsoftware/comms@0.2.3
  - @maroonedsoftware/logger@1.1.3
  - @maroonedsoftware/policies@0.5.3
  - @maroonedsoftware/errors@1.8.0

## 2.0.2

### Patch Changes

- Updated dependencies [b00d9b4]
  - @maroonedsoftware/errors@1.7.1
  - @maroonedsoftware/comms@0.2.2
  - @maroonedsoftware/policies@0.5.2

## 2.0.1

### Patch Changes

- b759188: Bump shared runtime dependencies: `injectkit` to `^1.6.0` across packages, plus package-specific bumps to `zxcvbn-ts` (authentication), `@slack/web-api` (slack), `mime-types` (storage), and `prettier` (permissions-dsl).
- Updated dependencies [b759188]
  - @maroonedsoftware/comms@0.2.1
  - @maroonedsoftware/logger@1.1.2
  - @maroonedsoftware/policies@0.5.1

## 2.0.0

### Minor Changes

- fe8ec2c: Add a `./comms` adapter subpath to each chat package, binding it to the channel-agnostic `@maroonedsoftware/comms` router (declared as an optional peer dependency). Each exposes `dispatch<Channel>…` functions that normalize the channel's inbound payloads into comms events and a `create<Channel>Notifier` for proactive sends, so a single handler runs across every wired channel. The channel cores are unchanged.

### Patch Changes

- ab4acc2: Move `luxon` from `devDependencies` to `dependencies`. `slack.signature.ts` imports `luxon` at runtime, so it must be a regular dependency — it previously resolved only via workspace hoisting and would be missing for an isolated/published consumer.
- Updated dependencies [fe8ec2c]
  - @maroonedsoftware/comms@0.2.0

## 1.9.0

### Minor Changes

- 3422e87: Add `SlackSignaturePolicy` — a `@maroonedsoftware/policies` form of `verifySlackSignature`, registered under `SLACK_SIGNATURE_POLICY` (`'slack.signature.valid'`). It delegates to the existing helper so the v0 HMAC + replay-window logic stays a single source of truth, but answers as a `PolicyResult` (denying with the helper's `SlackSignatureFailureReason` as the denial reason) and anchors the replay window to the evaluation's `envelope.now`.

  The policy context (`rawBody` + a case-insensitive `getHeader` + `SlackSignatureOptions`) is structurally compatible with `@maroonedsoftware/koa`'s generic `SignaturePolicyContext<SlackSignatureOptions>`, so the koa `requireSignature` middleware can drive it once registered — without this package depending on koa. Adds a runtime dependency on `@maroonedsoftware/policies`.

### Patch Changes

- 3422e87: Replace native JS `Date` with Luxon `DateTime` throughout, per the repo's date/time convention. Native `Date` now appears only at true interop boundaries (e.g. converting a third-party adapter's `Date` with `DateTime.fromJSDate`).

  **Breaking — `@maroonedsoftware/authentication`:** OAuth 2.0 / OIDC token and factor types now use `DateTime` instead of `Date`:
  - `OAuth2Tokens.expiresAt` is now `DateTime | undefined`. Adapters implementing `OAuth2ProviderClient` must convert at the boundary — e.g. `DateTime.fromJSDate(arcticTokens.accessTokenExpiresAt())`.
  - `OAuth2FactorValue.refreshTokenExpiresAt`, `OidcFactorValue.refreshTokenExpiresAt`, and the `updateRefreshToken(...)` `refreshTokenExpiresAt` argument are now `DateTime` (optional; omit for a non-expiring refresh token, where the type was previously `Date | null`). Repository implementations that persist to a `timestamptz` column should call `.toJSDate()` on write and `DateTime.fromJSDate(...)` on read.
  - `OAuth2FactorService.refreshAccessToken(...)` now resolves `expiresAt?: DateTime` (was `Date | null`).

  **Breaking — `@maroonedsoftware/johnny5`:** `DaemonStatus.startedAt` is now a `DateTime` (was `Date`). The on-disk pid record is unchanged (still an ISO string).

  `@maroonedsoftware/encryption`, `@maroonedsoftware/koa`, and `@maroonedsoftware/slack` change only internal time computations (KMS decrypt-audit timestamp, rate-limit reset header, Slack signature default `now`); no public API change. `luxon` is added as a runtime dependency to `encryption`, `johnny5`, and `koa`.

- Updated dependencies [3422e87]
  - @maroonedsoftware/policies@0.5.0

## 1.8.2

### Patch Changes

- a167ee3: Bump runtime dependencies (notably `injectkit` to 1.4.1) and relax the pgboss job registration type guard so it accepts the updated `Identifier` shape.
- Updated dependencies [a167ee3]
  - @maroonedsoftware/logger@1.1.1

## 1.8.1

### Patch Changes

- Updated dependencies [108c1d4]
  - @maroonedsoftware/errors@1.7.0

## 1.8.0

### Minor Changes

- 8e7a209: feat: add Slack integration package. Includes `SlackClient` (wraps `@slack/web-api`, also handles incoming-webhook and `response_url` POSTs), `SlackDispatcher` with `dispatchEvent` / `dispatchCommand` / `dispatchInteraction` for routing parsed Slack payloads to typed handlers via per-concern handler maps, and `verifySlackSignature` — a pure helper that validates Slack's v0 HMAC scheme with replay protection. Transport-agnostic: no Koa or router dependency. Consumers wire it into whatever HTTP framework they're using.

### Patch Changes

- @maroonedsoftware/errors@1.6.0
- @maroonedsoftware/logger@1.1.0
