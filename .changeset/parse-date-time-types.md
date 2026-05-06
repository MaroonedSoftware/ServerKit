---
'@maroonedsoftware/kysely': minor
---

`KyselyPgTypeOverrides` now parses PostgreSQL `DATE` and `TIME` columns as Luxon `DateTime` (UTC), consistent with the existing `TIMESTAMP` and `TIMESTAMPTZ` parsers.
