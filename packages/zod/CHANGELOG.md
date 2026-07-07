# @maroonedsoftware/zod

## 0.4.4

### Patch Changes

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

- Updated dependencies [dfe5304]
  - @maroonedsoftware/errors@1.8.0

## 0.4.3

### Patch Changes

- Updated dependencies [b00d9b4]
  - @maroonedsoftware/errors@1.7.1

## 0.4.2

### Patch Changes

- Updated dependencies [108c1d4]
  - @maroonedsoftware/errors@1.7.0

## 0.4.1

### Patch Changes

- db220a1: chore: bump kysely, zod patch versions
- 9e2c2de: chore: update package versions for dependencies and devDependencies
  - @maroonedsoftware/errors@1.6.0

## 0.4.0

### Minor Changes

- c48adc0: fix: use issue message for invalid_union with no branch errors
  - Updated the error handling in the processIssue function to utilize the specific issue message when an invalid_union has no associated branch errors.
  - Added a test case to ensure that the correct message is returned in this scenario.

## 0.3.1

### Patch Changes

- Updated dependencies [7624166]
  - @maroonedsoftware/errors@1.6.0

## 0.3.0

### Minor Changes

- 0ef3fb0: feat: enhance error formatting in Zod validation
  - Introduced detailed error descriptions for various validation issues, including type mismatches, size constraints, and custom messages.
  - Refactored error processing logic to improve clarity and maintainability.
  - Added comprehensive unit tests to ensure accurate error formatting and handling for different validation scenarios.

## 0.2.1

### Patch Changes

- Updated dependencies [4e9ccf4]
  - @maroonedsoftware/errors@1.5.0

## 0.2.0

### Minor Changes

- b1005f4: adding jsdocs and updating readme

## 0.1.0

### Minor Changes

- b9940cc: initial release
