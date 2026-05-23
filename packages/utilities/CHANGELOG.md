# @maroonedsoftware/utilities

## 1.8.0

### Minor Changes

- d494e15: Add `Array` and `String` prototype extensions (`uniqueBy`, `cast`, `deleteProperties`, `intersect`, `arrayEquals`, `binarySearch`, `takeWhile`, `takeWhileAggregate`, `isNullOrUndefinedOrWhitespace`, `hasValue`, `mask`, `maskExceptLastFour`, `maskEmail`), the `joinNonEmpty` helper, and nullable-safe free functions `hasValue` / `isNullOrUndefinedOrWhitespace`.

  The extensions ship as an opt-in side-effect import — `import '@maroonedsoftware/utilities/extensions'` — so importing the main entry no longer touches global prototypes. Installed methods are defined non-enumerable so they do not leak into `for…in` loops or `Object.keys`. When a name is already present on the target prototype (e.g. a future Node release or another library installed it), the install is skipped and a single `console.warn` is emitted per colliding name.

  The two most generically-named methods are deliberately namespaced — `arrayEquals` (rather than `equals`/`compare`) and `uniqueBy` (rather than `unique`) — to leave room for TC39 additions. `uniqueBy` accepts any `(t: T) => unknown` selector so callers can dedup by computed or composed keys, not just by a property of `T`.

  `Array.prototype.intersect` preserves duplicates from the receiver when called without a comparer and correctly keeps falsy matches (`0`, `''`, `false`, `null`) when called with one. `Array.prototype.deleteProperties` returns a new array of shallow copies instead of mutating its receiver.

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
