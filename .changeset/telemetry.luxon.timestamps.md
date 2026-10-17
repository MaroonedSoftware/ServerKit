---
'@maroonedsoftware/telemetry': patch
---

`MetricsStore.series` and `names` now read a `timestamptz` the pool has already parsed into a Luxon `DateTime`, which is what `@maroonedsoftware/kysely`'s `KyselyPgTypeOverrides` does. They threw a `TypeError` on such a pool before.
