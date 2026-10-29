---
'@maroonedsoftware/permissions': minor
---

`PermissionsTupleRepository.delete` takes an optional `deletedBy`, the counterpart of `write`'s `createdBy`, and its contract now allows a soft delete. A backend can keep the revoked row and who revoked it, provided every read leaves the row out. `ModelValidatingTupleRepository` forwards it.
