# @maroonedsoftware/multipart

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
