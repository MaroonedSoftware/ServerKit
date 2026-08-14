---
'@maroonedsoftware/cache': patch
---

Drop three unused dependencies and correct a stale JSDoc import path.

`@maroonedsoftware/errors`, `@maroonedsoftware/utilities`, and `rate-limiter-flexible` were declared
in `dependencies` but never imported by any file under `src/`. Removing them makes `cache` free of
internal dependencies and trims three packages from every install that pulls it in — `authentication`,
`discord`, `mcp`, `slack`, `telegram`, and `whatsapp` all depend on it.

Rate limiting lives in `@maroonedsoftware/koa` (`rateLimiterMiddleware` and the `RateLimiter` DI
token), not here; the dangling `rate-limiter-flexible` entry made the manifest suggest otherwise.

The `IoRedisCacheProvider` JSDoc example also showed `import { IoRedisCacheProvider } from '@maroonedsoftware/cache'`,
which does not resolve — the root barrel deliberately omits it so the core entry never loads the
optional `ioredis` peer. It now shows the `@maroonedsoftware/cache/ioredis` subpath.

No runtime behaviour changed.
