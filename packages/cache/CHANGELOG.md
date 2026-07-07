# @maroonedsoftware/cache

## 0.3.0

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
  - @maroonedsoftware/errors@1.8.0
  - @maroonedsoftware/utilities@1.11.0

## 0.2.2

### Patch Changes

- Updated dependencies [b00d9b4]
  - @maroonedsoftware/errors@1.7.1

## 0.2.1

### Patch Changes

- b759188: Bump shared runtime dependencies: `injectkit` to `^1.6.0` across packages, plus package-specific bumps to `zxcvbn-ts` (authentication), `@slack/web-api` (slack), `mime-types` (storage), and `prettier` (permissions-dsl).

## 0.2.0

### Minor Changes

- 5aa38f5: Move `IoRedisCacheProvider` behind a subpath export so importing the core no longer statically loads `ioredis`. Previously importing anything from `@maroonedsoftware/cache` eagerly required `ioredis`, even for consumers using the `CacheProvider` abstraction with a custom backend; `ioredis` is now an optional peer dependency.

  Breaking: import the ioredis backend from `@maroonedsoftware/cache/ioredis` instead of the package root. The core entry (`CacheProvider`) is unchanged.

## 0.1.9

### Patch Changes

- Updated dependencies [d5ccf3c]
  - @maroonedsoftware/utilities@1.10.0

## 0.1.8

### Patch Changes

- Updated dependencies [7503069]
  - @maroonedsoftware/utilities@1.9.0

## 0.1.7

### Patch Changes

- Updated dependencies [d494e15]
  - @maroonedsoftware/utilities@1.8.0

## 0.1.6

### Patch Changes

- a167ee3: Bump runtime dependencies (notably `injectkit` to 1.4.1) and relax the pgboss job registration type guard so it accepts the updated `Identifier` shape.
- Updated dependencies [a167ee3]
  - @maroonedsoftware/logger@1.1.1

## 0.1.5

### Patch Changes

- Updated dependencies [108c1d4]
  - @maroonedsoftware/errors@1.7.0

## 0.1.4

### Patch Changes

- 4814eff: Round TTL seconds to the nearest integer in `IoRedisCacheProvider`. Redis `EX` only accepts integer seconds, so fractional `Duration` values (e.g. `1500ms`) previously caused ioredis to reject the command.

## 0.1.3

### Patch Changes

- 9e2c2de: chore: update package versions for dependencies and devDependencies
  - @maroonedsoftware/errors@1.6.0
  - @maroonedsoftware/logger@1.1.0
  - @maroonedsoftware/utilities@1.7.0

## 0.1.2

### Patch Changes

- Updated dependencies [7624166]
  - @maroonedsoftware/errors@1.6.0

## 0.1.1

### Patch Changes

- Updated dependencies [4e9ccf4]
  - @maroonedsoftware/utilities@1.7.0
  - @maroonedsoftware/errors@1.5.0

## 0.1.0

### Minor Changes

- 687c984: Implement cache provider for authentication services
  - Introduced a new `@maroonedsoftware/cache` package with a `CacheProvider` interface and an `IoRedisCacheProvider` implementation using ioredis.
  - Updated authentication services to utilize the new cache provider, replacing direct cache provider imports with the new package.
  - Removed the old cache provider implementation from the authentication package.
  - Added tests for the new cache provider to ensure functionality and reliability.
  - Updated README and documentation for the cache package to guide usage and implementation.

### Patch Changes

- Updated dependencies [687c984]
  - @maroonedsoftware/utilities@1.6.0
