---
'@maroonedsoftware/permissions': minor
---

Every-object grants. A relation declared with `objectWildcard: true` accepts tuples whose object id is `*` (`doc:*.platform_admin@user:alice`), which grant the relation on every object of the namespace. Use them for platform-wide roles. `check` and `explain` read the `*` row only for opted-in relations. A `*` parent edge makes that parent apply to every object. `ModelValidatingTupleRepository` rejects `*` tuples on other relations with the new `object_wildcard_not_allowed` code. New exports: `OBJECT_WILDCARD`, `TupleObjectRef`, and `AuthorizationModel.allowsObjectWildcard`. `RelationTuple.object` is now a `TupleObjectRef`, which has the same shape as `ObjectRef`.
