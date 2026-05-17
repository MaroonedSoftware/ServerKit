---
'@maroonedsoftware/multipart': minor
---

Harden `MultipartBody` / `BusboyWrapper` against several edge cases:

- **Surface per-file size truncation as `413` instead of silently delivering a truncated file.** Previously, when a single file exceeded the configured `fileSize`, busboy ended the stream early and the user's `fileHandler` was handed a partial file with no indication anything was wrong. The wrapper now listens for `'limit'` on each file stream and rejects with `httpError(413).withInternalDetails({ reason: 'Reached file size limit', fieldname, filename })`.
- **Throw synchronously if `MultipartBody.parse()` is called more than once.** The request body can only be consumed once; the second call used to hang. It now throws a `ServerkitError` immediately.
- **Unpipe the request from busboy on the error path** so the rest of the body is not silently drained after the promise has already been rejected.
- **Defer listener wiring from the constructor into `parse()`** so that any limit / error / close event fired before parsing begins is not swallowed by the placeholder `resolve` / `reject` slots.
- **Reconcile the `MultipartLimits` JSDoc defaults** with `MultipartBody`'s stricter runtime defaults (`files: 1`, `fileSize: 20 MB`).
- **Export `MAX_FILE_SIZE`** (the 20 MB default) so callers can compose larger limits without re-declaring the magic number.

API surface: adds the named export `MAX_FILE_SIZE`. No existing exports were removed or renamed; error rejections that previously surfaced as silent corruption now surface as `413` (callers that wrap `parse()` in `try/catch` already see whatever the parser throws).
