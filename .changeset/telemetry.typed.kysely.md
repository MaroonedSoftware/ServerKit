---
'@maroonedsoftware/telemetry': patch
---

`MetricsStore` is generic over the app's database type, so an app's own `Kysely<DB>` is accepted without a cast. A typed `Kysely<DB>` was not assignable to the `Kysely<unknown>` it took before, so it could not be passed at all without one.
