---
'@maroonedsoftware/koa': minor
---

Expose client ipAddress on ServerKitContext and adjust middleware to: read user-agent via ctx.get (no default), set ipAddress from ctx.ip, read X-Correlation-Id from ctx.headers (handling array values) and always generate a new requestId (instead of honoring an incoming header). Update response headers accordingly.
