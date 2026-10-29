---
'@maroonedsoftware/permissions': minor
---

New `lookupObjects(model, repo, namespace, permission, subject, options?)` lists every object a concrete subject holds a permission on. It expands groups, `computed` chains, and recursive `tupleToUserset` hierarchies by walking the model backwards from the subject's tuples, then confirms each candidate with `checkDetailed` so that exclusions and intersections are honoured. An every-object `*` grant is reported as `everyObject: true` rather than enumerated. It requires a repository that implements `listObjects`.
