---
'@maroonedsoftware/errors': patch
---

Export `HttpStatusMap`, the status-code-to-message table `HttpError` already uses for its default
messages, so callers can check whether a numeric status is one `httpError` accepts.
