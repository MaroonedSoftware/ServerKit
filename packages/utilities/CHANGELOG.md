# @maroonedsoftware/utilities

## 1.11.0

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

## 1.10.0

### Minor Changes

- d5ccf3c: Add a `cityscape` avatar style: a deterministic, dependency-free city-skyline generator. Sky moods (`day`/`dusk`/`night`) with a sun or a phased moon, drifting clouds, night stars, and a soft "fuzzy" celestial glow (`celestialGlow`). Buildings render as famous-landmark silhouettes (`setback`, `artdeco`, `flatiron`, `modern`, `gothic`) plus a `plain` filler; in the default `mixed` mode each landmark appears at most once per skyline. Supports both a head-on `flat` layout and a two-point-`perspective` street corner, with per-window brightness/shade variation at night. Exposed via `generateCityscapeSvg` and the `cityscape` style on `generateAvatar`.

## 1.9.0

### Minor Changes

- 7503069: Add deterministic, dependency-free SVG avatar generators. New `generateAvatar(seed, { style })` dispatcher plus individual `generateFaceAvatarSvg`, `generateIdenticonSvg`, `generateGeometricSvg`, `generateGradientSwirlSvg`, and `generateSmileyAvatarSvg` exports, and a `toDataUri` helper. Every color, palette, size, and geometry constant is an optional override; omitting options reproduces the default look.

## 1.8.0

### Minor Changes

- d494e15: Add `Array` and `String` prototype extensions (`uniqueBy`, `cast`, `deleteProperties`, `intersect`, `arrayEquals`, `binarySearch`, `takeWhile`, `takeWhileAggregate`, `isNullOrUndefinedOrWhitespace`, `hasValue`, `mask`, `maskExceptLastFour`, `maskEmail`), the `joinNonEmpty` helper, and nullable-safe free functions `hasValue` / `isNullOrUndefinedOrWhitespace`.

  The extensions ship as an opt-in side-effect import — `import '@maroonedsoftware/utilities/extensions'` — so importing the main entry no longer touches global prototypes. Installed methods are defined non-enumerable so they do not leak into `for…in` loops or `Object.keys`. When a name is already present on the target prototype (e.g. a future Node release or another library installed it), the install is skipped and a single `console.warn` is emitted per colliding name.

  The two most generically-named methods are deliberately namespaced — `arrayEquals` (rather than `equals`/`compare`) and `uniqueBy` (rather than `unique`) — to leave room for TC39 additions. `uniqueBy` accepts any `(t: T) => unknown` selector so callers can dedup by computed or composed keys, not just by a property of `T`.

  `Array.prototype.intersect` preserves duplicates from the receiver when called without a comparer and correctly keeps falsy matches (`0`, `''`, `false`, `null`) when called with one. `Array.prototype.deleteProperties` returns a new array of shallow copies instead of mutating its receiver.

## 1.7.0

### Minor Changes

- 4e9ccf4: Update error handling and type overrides
  - Updated Kysely type overrides to include custom parsers for `INTERVAL` and `TINTERVAL`, improving PostgreSQL type handling.
  - Renamed `withErrors(errors)` to `withDetails(details)` in the errors package documentation for clarity.
  - Added a class decorator `OnPostgresError` to automatically map PostgreSQL errors to HTTP errors, enhancing error handling in services.
  - Enhanced tests for Kysely type overrides to cover new interval parsing functionality.
  - Added documentation for E.164 international phone number format in the utilities package.

## 1.6.0

### Minor Changes

- 687c984: Implement cache provider for authentication services
  - Introduced a new `@maroonedsoftware/cache` package with a `CacheProvider` interface and an `IoRedisCacheProvider` implementation using ioredis.
  - Updated authentication services to utilize the new cache provider, replacing direct cache provider imports with the new package.
  - Removed the old cache provider implementation from the authentication package.
  - Added tests for the new cache provider to ensure functionality and reliability.
  - Updated README and documentation for the cache package to guide usage and implementation.

## 1.5.0

### Minor Changes

- 5c4756a: Add a recursive binarySearch<T>(array, value) utility and an isPhoneE164(phone) validator using an E.164 regex.

## 1.4.0

### Minor Changes

- b1005f4: adding jsdocs and updating readme

## 1.3.0

### Minor Changes

- b9940cc: added bigint and null to undefined helpers

## 1.2.0

### Minor Changes

- 922f585: upgrading to typescript 6

## 1.1.0

### Minor Changes

- 0eea499: added unique helper

## 1.0.0

### Major Changes

- 2d69860: Initial release
