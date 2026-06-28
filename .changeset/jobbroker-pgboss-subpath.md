---
'@maroonedsoftware/jobbroker': minor
---

Move the pg-boss backend behind a subpath export so importing the core no longer statically loads `pg-boss`. `pg-boss` is now an optional peer dependency, and the core entry (`Job`, `JobBroker`, `JobRunner`) pulls in no backend.

Breaking: import the pg-boss classes (`PgBossJobBroker`, `PgBossJobRunner`, `PgBossJobRegistryMap`, `PgBossConnectionProvider`) from `@maroonedsoftware/jobbroker/pgboss` instead of the package root.
