---
'@maroonedsoftware/permissions': minor
---

New `@maroonedsoftware/permissions/conformance` subpath with `verifyTupleRepository`, a test-runner-agnostic check of a `PermissionsTupleRepository` against the contract the evaluator relies on. It checks idempotent writes, that deleted tuples vanish from every read (with or without `deletedBy`), that a re-grant after a revoke is visible, that parent edges are concrete only, that `*` object ids come back literally, and that listings match the exact subject. The `delete` contract now recommends keeping revocation history by moving the row to a history table in the same transaction, rather than flagging it in the live table. The package gains an `exports` map; the root import is unchanged.
