---
'@maroonedsoftware/kysely': minor
---

Remove the InferDatabase helper and simplify KyselyRepository to use a DB type parameter. Update the constructor to accept Kysely<DB> and adjust Transaction types in withTransaction/withSerializedTransaction accordingly. Update README example to reflect the new generic and remove the redundant constructor, and update tests to use KyselyRepository<TestDB> and simplify mockImplementation callbacks to single-line lambdas. This is a type-level refactor to make the repository API simpler while preserving runtime behavior.
