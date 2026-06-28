---
'@maroonedsoftware/cache': minor
---

Move `IoRedisCacheProvider` behind a subpath export so importing the core no longer statically loads `ioredis`. Previously importing anything from `@maroonedsoftware/cache` eagerly required `ioredis`, even for consumers using the `CacheProvider` abstraction with a custom backend; `ioredis` is now an optional peer dependency.

Breaking: import the ioredis backend from `@maroonedsoftware/cache/ioredis` instead of the package root. The core entry (`CacheProvider`) is unchanged.
