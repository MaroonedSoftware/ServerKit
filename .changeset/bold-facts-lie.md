---
'@maroonedsoftware/koa': minor
---

Normalize response header names to lowercase in the rate limiter middleware. The middleware now emits 'retry-after', 'x-ratelimit-limit', 'x-ratelimit-remaining', and 'x-ratelimit-reset' instead of their PascalCase equivalents; no functional behavior changes to rate limiting logic.
