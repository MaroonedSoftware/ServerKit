# @maroonedsoftware/kysely

## 0.2.0

### Minor Changes

- e734dbd: Introduce an InferDatabase<T> helper and make KyselyRepository generic over the concrete Kysely instance (TKysely extends Kysely<any>) instead of the DB type directly. Update constructor and transaction method signatures to use Transaction<InferDatabase<TKysely>>. This lets the repository infer the DB schema from the provided Kysely instance and avoids repeating the DB type parameter.

## 0.1.0

### Minor Changes

- dac59da: adding kysely package
