---
'@maroonedsoftware/permissions': minor
---

Add reverse listings to the tuple repository contract: `listSubjects(namespace, objectId, relation)`
answers "who is on this object?" and `listObjects(namespace, relation, subject)` answers "what is
this subject on?". Neither existed, so there was no way to enumerate a relation's members without
reaching past the repository.

Both are optional on `PermissionsTupleRepository` so existing implementations keep compiling; check
for the method before calling it. `InMemoryTupleRepository` implements both. `listObjects` is a
direct-tuple index, not a Check, so a subject with access only through a `tupleToUserset` parent
does not appear in its results.
