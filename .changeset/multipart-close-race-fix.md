---
'@maroonedsoftware/multipart': patch
---

Fix `MultipartBody.parse()` hanging when the HTTP request emits `close` before busboy
has finished draining buffered data. The previous unconditional `req.on('close', cleanup)`
hook stripped the `'finish'` listener mid-parse, so async file handlers (e.g. `for await
(const chunk of stream)`) would never see resolution. The close handler now distinguishes
a normal close (`req.complete === true` — let `finalize()` handle teardown) from a
premature client disconnect (rejects with an HTTP 400).

Also fixes a latent bug where `cleanup()` passed `this.cleanup` to `removeListener`
even though the original listener was registered as `() => this.cleanup()` — the
reference mismatch made the `removeListener` call a silent no-op.

No public API change.
