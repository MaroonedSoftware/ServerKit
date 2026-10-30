---
'@maroonedsoftware/kysely': minor
---

Add `DateTimeParameterPlugin` to `KyselyDefaultPlugins`, so Luxon `DateTime` query parameters reach Postgres as ISO strings instead of through `pg`'s `JSON.stringify` fallback. An invalid `DateTime` now throws when the query is compiled rather than reaching the database.
