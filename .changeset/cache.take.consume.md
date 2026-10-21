---
'@maroonedsoftware/cache': minor
---

Add `CacheProvider.take(key)`, an atomic get-and-delete for consuming single-use entries. `IoRedisCacheProvider` implements it with `GETDEL`, which needs Redis 6.2 or later.

**Breaking for custom providers:** `take` is abstract, so any class that extends or implements `CacheProvider` outside this package must add it. It is deliberately not given a default `get`-then-`delete` implementation, because that would silently lose the atomicity callers rely on. The package is pre-1.0, so this ships as a minor bump.
