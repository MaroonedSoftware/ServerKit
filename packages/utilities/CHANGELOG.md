# @maroonedsoftware/utilities

## 1.7.0

### Minor Changes

- 4e9ccf4: Update error handling and type overrides
  - Updated Kysely type overrides to include custom parsers for `INTERVAL` and `TINTERVAL`, improving PostgreSQL type handling.
  - Renamed `withErrors(errors)` to `withDetails(details)` in the errors package documentation for clarity.
  - Added a class decorator `OnPostgresError` to automatically map PostgreSQL errors to HTTP errors, enhancing error handling in services.
  - Enhanced tests for Kysely type overrides to cover new interval parsing functionality.
  - Added documentation for E.164 international phone number format in the utilities package.

## 1.6.0

### Minor Changes

- 687c984: Implement cache provider for authentication services
  - Introduced a new `@maroonedsoftware/cache` package with a `CacheProvider` interface and an `IoRedisCacheProvider` implementation using ioredis.
  - Updated authentication services to utilize the new cache provider, replacing direct cache provider imports with the new package.
  - Removed the old cache provider implementation from the authentication package.
  - Added tests for the new cache provider to ensure functionality and reliability.
  - Updated README and documentation for the cache package to guide usage and implementation.

## 1.5.0

### Minor Changes

- 5c4756a: Add a recursive binarySearch<T>(array, value) utility and an isPhoneE164(phone) validator using an E.164 regex.

## 1.4.0

### Minor Changes

- b1005f4: adding jsdocs and updating readme

## 1.3.0

### Minor Changes

- b9940cc: added bigint and null to undefined helpers

## 1.2.0

### Minor Changes

- 922f585: upgrading to typescript 6

## 1.1.0

### Minor Changes

- 0eea499: added unique helper

## 1.0.0

### Major Changes

- 2d69860: Initial release
