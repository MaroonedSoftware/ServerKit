---
'@maroonedsoftware/kysely': minor
---

Add `StripSysPeriodPlugin`, an opt-in plugin that keeps a system-versioned table's `sys_period` out of query results. A query that touches a history table keeps the column, wherever that table appears, and so does a raw query. `columns` and `historySuffix` change what it removes and which tables count as history.
