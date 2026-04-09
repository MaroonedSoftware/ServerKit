---
'@maroonedsoftware/kysely': minor
---

Introduce an InferDatabase<T> helper and make KyselyRepository generic over the concrete Kysely instance (TKysely extends Kysely<any>) instead of the DB type directly. Update constructor and transaction method signatures to use Transaction<InferDatabase<TKysely>>. This lets the repository infer the DB schema from the provided Kysely instance and avoids repeating the DB type parameter.
