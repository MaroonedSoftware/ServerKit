---
'@maroonedsoftware/telemetry': minor
---

Add `@maroonedsoftware/telemetry/kysely`: a `MetricsStore` that keeps metric buckets in one PostgreSQL table at minute and hour resolution. Upserts merge a later flush of the same minute into the stored row, `rollupHour` folds an hour of minutes into an hour row idempotently, `prune` ages each resolution out on its own window, and `series` / `names` read them back. Also adds `resolutionFor` to the root entry. `kysely` is an optional peer.
