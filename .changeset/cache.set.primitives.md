---
'@maroonedsoftware/cache': minor
---

Add atomic set operations to `CacheProvider`: `setAdd(key, member, { ttl? })`, `setRemove(key, member)` and `setMembers(key)`. They let several writers maintain one collection (an index of ids, say) without the lost updates a read-modify-write of a JSON array suffers. `setAdd` only ever extends the set's expiry. `IoRedisCacheProvider` implements them with `SADD` (plus the expiry, in one Lua script), `SREM` and `SMEMBERS`.

Custom `CacheProvider` subclasses must implement the three new abstract methods.
