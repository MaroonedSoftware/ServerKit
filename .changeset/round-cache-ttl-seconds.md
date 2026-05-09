---
'@maroonedsoftware/cache': patch
---

Round TTL seconds to the nearest integer in `IoRedisCacheProvider`. Redis `EX` only accepts integer seconds, so fractional `Duration` values (e.g. `1500ms`) previously caused ioredis to reject the command.
