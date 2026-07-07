# @maroonedsoftware/slack

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
