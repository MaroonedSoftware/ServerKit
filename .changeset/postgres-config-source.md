---
'@maroonedsoftware/appconfig': minor
---

Add `AppConfigPostgresSource`, a configuration source that loads key/value rows from a Postgres table (configurable schema, table, and key/value columns). Connection parameters and schema are supplied via the injectable `AppConfigPostgresSourceOptions`. `pg` is a new optional peer dependency.
