---
'@maroonedsoftware/errors': patch
'@maroonedsoftware/permissions-dsl': patch
---

Reduce cyclomatic/cognitive complexity in three internal hotspots with no change to public behavior: `PostgresErrorHandler` now maps SQLSTATE codes via a lookup table instead of a large switch, and `permissions-dsl`'s `compile` and reference-validation pass are split into focused, single-responsibility helpers.
