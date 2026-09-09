---
'@maroonedsoftware/scim': patch
---

Ignore a client-supplied `id` when creating a SCIM user or group. RFC 7643 §3.1 makes `id`
server-assigned and readOnly, but `create` previously took `payload.id` when present, so a POST
carrying an existing record's id passed the uniqueness check and reached the repository with a
colliding primary key.
