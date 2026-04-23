# @maroonedsoftware/kysely

## 0.4.0

### Minor Changes

- 4e9ccf4: Update error handling and type overrides
  - Updated Kysely type overrides to include custom parsers for `INTERVAL` and `TINTERVAL`, improving PostgreSQL type handling.
  - Renamed `withErrors(errors)` to `withDetails(details)` in the errors package documentation for clarity.
  - Added a class decorator `OnPostgresError` to automatically map PostgreSQL errors to HTTP errors, enhancing error handling in services.
  - Enhanced tests for Kysely type overrides to cover new interval parsing functionality.
  - Added documentation for E.164 international phone number format in the utilities package.

### Patch Changes

- Updated dependencies [4e9ccf4]
  - @maroonedsoftware/utilities@1.7.0
  - @maroonedsoftware/errors@1.5.0

## 0.3.2

### Patch Changes

- Updated dependencies [687c984]
  - @maroonedsoftware/utilities@1.6.0

## 0.3.1

### Patch Changes

- Updated dependencies [5c4756a]
  - @maroonedsoftware/utilities@1.5.0

## 0.3.0

### Minor Changes

- 1b9a5fe: Remove the InferDatabase helper and simplify KyselyRepository to use a DB type parameter. Update the constructor to accept Kysely<DB> and adjust Transaction types in withTransaction/withSerializedTransaction accordingly. Update README example to reflect the new generic and remove the redundant constructor, and update tests to use KyselyRepository<TestDB> and simplify mockImplementation callbacks to single-line lambdas. This is a type-level refactor to make the repository API simpler while preserving runtime behavior.

## 0.2.0

### Minor Changes

- e734dbd: Introduce an InferDatabase<T> helper and make KyselyRepository generic over the concrete Kysely instance (TKysely extends Kysely<any>) instead of the DB type directly. Update constructor and transaction method signatures to use Transaction<InferDatabase<TKysely>>. This lets the repository infer the DB schema from the provided Kysely instance and avoids repeating the DB type parameter.

## 0.1.0

### Minor Changes

- dac59da: adding kysely package
