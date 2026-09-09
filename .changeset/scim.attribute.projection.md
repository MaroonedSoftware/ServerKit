---
'@maroonedsoftware/scim': minor
---

Apply `attributes` and `excludedAttributes` to SCIM responses, and strip attributes the schema
declares `returned: 'never'`. Both parameters were parsed into `ScimListQuery` and handed to the
repository, but nothing in the package ever applied them, and single-resource reads and writes did
not parse them at all. `password`, declared `writeOnly` and `returned: 'never'` on the User schema,
was returned verbatim by any repository that round-tripped what it stored.

Adds `projectScimResource(resource, schemas, projection)` and the `ScimProjection` type, and runs
every user and group response through it.
