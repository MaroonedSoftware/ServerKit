---
'@maroonedsoftware/jobbroker': minor
---

Add `KyselyTransactionConnectionProvider` to `@maroonedsoftware/jobbroker/pgboss`.

Register it as a request-scoped override of `PgBossConnectionProvider` and every enqueue performed during the request inserts on the active Kysely transaction's connection, so the job row and the surrounding domain writes commit or roll back together. It strips Kysely plugins before adapting the transaction, since pg-boss runs raw SQL through `executeQuery` and a column-rewriting plugin would corrupt pg-boss's own result columns.

The constructor accepts `KyselyLike`, a structural type satisfied by both `Kysely<DB>` and `Transaction<DB>` with no type argument or cast, so the package still has no dependency on `kysely`.
