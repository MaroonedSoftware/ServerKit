# @maroonedsoftware/multipart

## 1.3.0

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

## 1.2.2

### Patch Changes

- Updated dependencies [b00d9b4]
  - @maroonedsoftware/errors@1.7.1

## 1.2.1

### Patch Changes

- Updated dependencies [108c1d4]
  - @maroonedsoftware/errors@1.7.0

## 1.2.0

### Minor Changes

- 3ed349d: Harden `MultipartBody` / `BusboyWrapper` against several edge cases:
  - **Surface per-file size truncation as `413` instead of silently delivering a truncated file.** Previously, when a single file exceeded the configured `fileSize`, busboy ended the stream early and the user's `fileHandler` was handed a partial file with no indication anything was wrong. The wrapper now listens for `'limit'` on each file stream and rejects with `httpError(413).withInternalDetails({ reason: 'Reached file size limit', fieldname, filename })`.
  - **Throw synchronously if `MultipartBody.parse()` is called more than once.** The request body can only be consumed once; the second call used to hang. It now throws a `ServerkitError` immediately.
  - **Unpipe the request from busboy on the error path** so the rest of the body is not silently drained after the promise has already been rejected.
  - **Defer listener wiring from the constructor into `parse()`** so that any limit / error / close event fired before parsing begins is not swallowed by the placeholder `resolve` / `reject` slots.
  - **Reconcile the `MultipartLimits` JSDoc defaults** with `MultipartBody`'s stricter runtime defaults (`files: 1`, `fileSize: 20 MB`).
  - **Export `MAX_FILE_SIZE`** (the 20 MB default) so callers can compose larger limits without re-declaring the magic number.

  API surface: adds the named export `MAX_FILE_SIZE`. No existing exports were removed or renamed; error rejections that previously surfaced as silent corruption now surface as `413` (callers that wrap `parse()` in `try/catch` already see whatever the parser throws).

### Patch Changes

- 7c85ab4: Fix `MultipartBody.parse()` hanging when the HTTP request emits `close` before busboy
  has finished draining buffered data. The previous unconditional `req.on('close', cleanup)`
  hook stripped the `'finish'` listener mid-parse, so async file handlers (e.g. `for await
(const chunk of stream)`) would never see resolution. The close handler now distinguishes
  a normal close (`req.complete === true` — let `finalize()` handle teardown) from a
  premature client disconnect (rejects with an HTTP 400).

  Also fixes a latent bug where `cleanup()` passed `this.cleanup` to `removeListener`
  even though the original listener was registered as `() => this.cleanup()` — the
  reference mismatch made the `removeListener` call a silent no-op.

  No public API change.

## 1.1.2

### Patch Changes

- Updated dependencies [7624166]
  - @maroonedsoftware/errors@1.6.0

## 1.1.1

### Patch Changes

- Updated dependencies [4e9ccf4]
  - @maroonedsoftware/errors@1.5.0

## 1.1.0

### Minor Changes

- 922f585: upgrading to typescript 6

### Patch Changes

- Updated dependencies [922f585]
  - @maroonedsoftware/errors@1.4.0

## 1.0.3

### Patch Changes

- Updated dependencies [5ded700]
  - @maroonedsoftware/errors@1.3.0

## 1.0.2

### Patch Changes

- Updated dependencies [3f636dd]
  - @maroonedsoftware/errors@1.2.0

## 1.0.1

### Patch Changes

- Updated dependencies [8ab564a]
  - @maroonedsoftware/errors@1.1.0

## 1.0.0

### Major Changes

- 2d69860: Initial release

### Patch Changes

- Updated dependencies [2d69860]
  - @maroonedsoftware/errors@1.0.0
