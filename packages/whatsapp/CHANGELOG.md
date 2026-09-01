# @maroonedsoftware/whatsapp

## 2.0.9

### Patch Changes

- Updated dependencies [8557da7]
  - @maroonedsoftware/policies@0.6.8

## 2.0.8

### Patch Changes

- 7587006: Update runtime dependency ranges across the workspace (injectkit ^1.7.1, zod ^4.5.4, deepmerge-ts ^8, raw-body ^4, qs ^6.16, kysely ^0.29.5, pg ^8.23, @modelcontextprotocol/sdk ^1.30, @fastify/busboy ^3.2.2, and related minors).
- Updated dependencies [7587006]
- Updated dependencies [7587006]
  - @maroonedsoftware/cache@0.5.0
  - @maroonedsoftware/comms@0.2.10
  - @maroonedsoftware/logger@1.1.9
  - @maroonedsoftware/policies@0.6.7

## 2.0.7

### Patch Changes

- Updated dependencies [e2e968d]
  - @maroonedsoftware/errors@1.9.0
  - @maroonedsoftware/comms@0.2.9
  - @maroonedsoftware/policies@0.6.6

## 2.0.6

### Patch Changes

- be035ce: Ship the MIT LICENSE file in the published package tarball, and link to it from the README.
- Updated dependencies [be035ce]
  - @maroonedsoftware/cache@0.4.5
  - @maroonedsoftware/comms@0.2.8
  - @maroonedsoftware/errors@1.8.5
  - @maroonedsoftware/logger@1.1.8
  - @maroonedsoftware/policies@0.6.5

## 2.0.5

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

## 2.0.4

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

## 2.0.3

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

## 2.0.2

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

## 2.0.1

### Patch Changes

- Updated dependencies [b7e1163]
  - @maroonedsoftware/policies@0.6.0

## 2.0.0

### Minor Changes

- de7fef3: Add opt-in webhook de-duplication for at-least-once delivery.

  - **cache**: new `IdempotencyStore` abstraction and default `CacheIdempotencyStore` (backed by the atomic `CacheProvider.add` claim primitive). `deduplicate(key, work, options?)` runs `work` at most once per key across processes, returning `processed` / `duplicate` / `dropped`. It uses an in-flight claim (`inFlightTtl`), a configurable retention window (`retentionTtl`), and a poison-event attempt cap (`maxAttempts`) so a permanently-failing event is dead-lettered rather than reprocessed forever.
  - **slack / discord / telegram / whatsapp**: each dispatch method now accepts an optional trailing `{ idempotency }` argument and exports a per-platform key helper — `slackEventIdempotencyKey`, `discordInteractionIdempotencyKey`, `telegramUpdateIdempotencyKey`, and `whatsappMessageIdempotencyKey` / `whatsappStatusIdempotencyKey`. De-duplication is fully opt-in: when no store is passed, behavior is byte-for-byte unchanged. `@maroonedsoftware/cache` is declared as an optional peer dependency (type-only import, no runtime dependency when unused). See each package README for the recommended durable enqueue-and-ack pattern and the edge de-dup one-liner.

### Patch Changes

- Updated dependencies [de7fef3]
  - @maroonedsoftware/cache@0.4.0

## 1.1.0

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

## 1.0.2

### Patch Changes

- Updated dependencies [b00d9b4]
  - @maroonedsoftware/errors@1.7.1
  - @maroonedsoftware/comms@0.2.2
  - @maroonedsoftware/policies@0.5.2

## 1.0.1

### Patch Changes

- b759188: Bump shared runtime dependencies: `injectkit` to `^1.6.0` across packages, plus package-specific bumps to `zxcvbn-ts` (authentication), `@slack/web-api` (slack), `mime-types` (storage), and `prettier` (permissions-dsl).
- Updated dependencies [b759188]
  - @maroonedsoftware/comms@0.2.1
  - @maroonedsoftware/logger@1.1.2
  - @maroonedsoftware/policies@0.5.1

## 1.0.0

### Minor Changes

- fe8ec2c: Add a `./comms` adapter subpath to each chat package, binding it to the channel-agnostic `@maroonedsoftware/comms` router (declared as an optional peer dependency). Each exposes `dispatch<Channel>…` functions that normalize the channel's inbound payloads into comms events and a `create<Channel>Notifier` for proactive sends, so a single handler runs across every wired channel. The channel cores are unchanged.
- fe8ec2c: Add `@maroonedsoftware/whatsapp`: a transport-agnostic WhatsApp Cloud API integration modeled on `@maroonedsoftware/slack`. Includes `WhatsAppDispatcher` for routing batched webhook bodies (messages by type, interactive replies by id, statuses by value) to typed handlers, HMAC-SHA256 signature verification (`verifyWhatsAppSignature` + `WhatsAppSignaturePolicy`), the subscription verification handshake helper (`verifyWhatsAppWebhook`), a `fetch`-based `WhatsAppClient` Graph API wrapper, and DI-friendly `WhatsAppConfig`/`WhatsAppError`.

### Patch Changes

- Updated dependencies [fe8ec2c]
  - @maroonedsoftware/comms@0.2.0
