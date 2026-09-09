---
'@maroonedsoftware/permissions': minor
---

Enforce `RelationDef.subjects` on write. The field was documented as a write-time contract, but
nothing in the package enforced it and no shipped repository validated on the way in, so a relation
deliberately declared without `user.*` was still world-grantable by writing that tuple directly.

Adds `AuthorizationModel.isSubjectAllowed` and `assertTuplesAllowed`, plus a
`ModelValidatingTupleRepository` decorator that wraps any repository and validates before writing.
Reads pass straight through, and deletes are not validated.
