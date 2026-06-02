---
'@maroonedsoftware/kysely': minor
---

Add `EmptyUpdateRewriteDialect`, a PostgreSQL dialect that turns an empty `UPDATE` (no columns to set — e.g. `.set({})` or a PATCH body whose fields all arrived `undefined`, which Kysely drops) into a no-op `SELECT` of the current row instead of letting PostgreSQL fail with a `42601` syntax error. The statement stays an `UpdateQueryNode` (so `.execute()` still resolves an update result with `numUpdatedRows` of `0n`) but compiles to `SELECT`, so no row is written and no `UPDATE` trigger fires. Also exports the underlying `EmptyUpdateRewriteCompiler` for advanced composition.
