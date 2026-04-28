# @maroonedsoftware/permissions

## 0.1.0

### Minor Changes

- 433097f: Add the `@maroonedsoftware/permissions` package — a Zanzibar-style relationship-based access control library with an authorization model DSL (`direct`, `computed`, `tupleToUserset`, `union`, `intersection`, `exclusion`), a validated `AuthorizationModel`, an abstract `PermissionsTupleRepository` for pluggable storage, and a recursive Check evaluator with per-request memo, cycle guard, and a pluggable `CheckMetricsSink` (with a built-in `LoggingMetricsSink`).
