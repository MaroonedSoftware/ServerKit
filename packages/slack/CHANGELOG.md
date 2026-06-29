# @maroonedsoftware/slack

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
