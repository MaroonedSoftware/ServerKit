---
'@maroonedsoftware/kysely': minor
---

Add `TestDatabaseCluster` at `@maroonedsoftware/kysely/testing`: each test file gets its own database, cloned from a template built once per run, and runs that share a cluster sweep each other's abandoned databases without touching a live one. The package now has an `exports` map, so imports of paths other than the package root and `./testing` no longer resolve.
