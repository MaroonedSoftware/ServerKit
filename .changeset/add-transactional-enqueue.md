---
'@maroonedsoftware/jobbroker': minor
---

Support transactional job enqueue via a `PgBossConnectionProvider`. `PgBossJobBroker` now sources the pg-boss `db` executor for each `send`/`schedule` from an injected `PgBossConnectionProvider`, so overriding it in a request scope (e.g. with pg-boss's `fromKysely(trx)`) enqueues jobs atomically with the surrounding transaction. The default provider preserves existing pooled behavior. BREAKING: `PgBossJobBroker` now requires a `PgBossConnectionProvider` constructor argument — register `PgBossConnectionProvider` in your DI container.
