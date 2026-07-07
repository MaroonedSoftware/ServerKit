# @maroonedsoftware/errors

## 1.8.0

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

## 1.7.1

### Patch Changes

- b00d9b4: Reduce cyclomatic/cognitive complexity in three internal hotspots with no change to public behavior: `PostgresErrorHandler` now maps SQLSTATE codes via a lookup table instead of a large switch, and `permissions-dsl`'s `compile` and reference-validation pass are split into focused, single-responsibility helpers.

## 1.7.0

### Minor Changes

- 108c1d4: Cross-package security and correctness audit.
  - **authentication**: `JwtAuthenticationIssuer.parse` now receives both the raw `token` and the decoded `payload` (was just `payload`) — implementations **must** verify the signature against trusted key material because the payload is unverified. `JwtProvider` accepts an optional `pemPublicKey` and now verifies tokens with the public key (derived from the private PEM when not supplied) so verification paths never have to hold the signing key. `updateSession` resets `expiresAt` to `now + expiration` (absolute) instead of stacking it on top of the existing expiry — a chatty client can no longer extend a session past its configured lifetime. FIDO assertion verification rejects factors that are missing their replay counter instead of silently degrading to "no counter check". Magic-link redirect HTML now embeds the URL via `JSON.stringify` so the assignment string cannot be escaped. Authorization-header parsing splits on the first space only, preserving multi-token credentials such as `Digest username="…", nonce="…"`.
  - **encryption**: `EncryptionProvider.createKey` is now `async` and derives keys with **Argon2id** (the OWASP-recommended memory-hard KDF, shared with `Argon2idPasswordHashProvider` via the new `ARGON2ID_DEFAULTS` export) instead of PBKDF2-HMAC-SHA512 at 65 535 iterations. Callers must `await` and any keys previously derived from a passphrase will no longer match — re-derive and re-encrypt. The per-id lock chain inside `InMemoryKmsProvider` was rewritten with `async`/`await`, fixing a `prev.then(fn, fn)` bug that broke serialisation when a queued operation rejected. Removed an unreachable `KeyRetiredError` guard on the encrypt path. `kms/in-memory.kms.provider.ts` renamed to `kms/in.memory.kms.provider.ts` to match the project's dot-separated filename convention — deep imports must update the path.
  - **errors**: The `@OnError` decorator now **rethrows** the original error after invoking the handler. Handlers that map errors continue to work (they throw their replacement, which short-circuits the rethrow); handlers that only logged and swallowed will start propagating errors. `isPostgresError` is stricter — it requires `code` to be a string in the 5-character SQLSTATE shape, so generic Node errors (`ENOENT`, axios errors with a `code`, etc.) are no longer mis-routed through the Postgres mapper.
  - **appconfig**: `AppConfigProviderGcpSecrets.getSecret` now throws a `ServerkitError` (with the original error attached as `cause` and `secretId` / `projectId` in `internalDetails`) when Secret Manager rejects, instead of silently substituting `''` and booting the service with empty passwords / API keys. `canParse` resets the regex's `lastIndex` before testing, fixing a stateful-`/g`-flag bug that returned `false` for matching strings on subsequent calls. `AppConfigBuilder.build()` now returns an empty config when no sources are registered instead of crashing on `deepmerge()` of zero arguments. Added a workspace dependency on `@maroonedsoftware/errors`.
  - **jobbroker**: `PgBossJobRunner` now `await`s `pgboss.work(...)` and wraps the per-batch job execution in `Promise.allSettled`, so pg-boss no longer marks a batch complete before the jobs have actually finished. Each job in a batch now resolves its own `Job` instance from the DI container, matching the documented "resolved for each execution" contract.
  - **koa**: `requireSignature` middleware compares HMAC digests with `crypto.timingSafeEqual` (with a length guard for missing/short signatures) instead of `!==`, removing a timing-attack vector on webhook signatures.
  - **scim**: `ScimUserService` and `ScimGroupService` use Luxon `DateTime.utc().toISO()` for `meta.created` / `meta.lastModified` instead of native `Date#toISOString()`, matching the project-wide Luxon convention.

## 1.6.0

### Minor Changes

- 7624166: feat: introduce ServerkitError class for enhanced error handling
  - Added `ServerkitError` as a base class for non-HTTP errors, providing `details`, `cause`, and `internalDetails` properties with fluent setters.
  - Updated `HttpError` to extend `ServerkitError`, inheriting its features while adding HTTP-specific properties.
  - Enhanced README documentation to include usage examples for `ServerkitError` and its integration with `HttpError`.
  - Implemented type guard `IsServerkitError` to identify instances of `ServerkitError` and its subclasses.
  - Added unit tests for `ServerkitError` to validate functionality and ensure proper subclassing behavior.

## 1.5.0

### Minor Changes

- 4e9ccf4: Update error handling and type overrides
  - Updated Kysely type overrides to include custom parsers for `INTERVAL` and `TINTERVAL`, improving PostgreSQL type handling.
  - Renamed `withErrors(errors)` to `withDetails(details)` in the errors package documentation for clarity.
  - Added a class decorator `OnPostgresError` to automatically map PostgreSQL errors to HTTP errors, enhancing error handling in services.
  - Enhanced tests for Kysely type overrides to cover new interval parsing functionality.
  - Added documentation for E.164 international phone number format in the utilities package.

## 1.4.0

### Minor Changes

- 922f585: upgrading to typescript 6

## 1.3.0

### Minor Changes

- 5ded700: updating tests

## 1.2.0

### Minor Changes

- 3f636dd: adding additional postgres error codes to be handled

## 1.1.0

### Minor Changes

- 8ab564a: refactored withErrors to withDetails to be more accurate

## 1.0.0

### Major Changes

- 2d69860: Initial release
