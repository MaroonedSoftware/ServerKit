# @maroonedsoftware/errors

## 1.6.0

### Minor Changes

- 7624166: feat: introduce ServerkitError class for enhanced error handling
  - Added `ServerkitError` as a base class for non-HTTP errors, providing `details`, `cause`, and `internalDetails` properties with fluent setters.
  - Updated `HttpError` to extend `ServerkitError`, inheriting its features while adding HTTP-specific properties.
  - Enhanced README documentation to include usage examples for `ServerkitError` and its integration with `HttpError`.
  - Implemented type guard `IsServerkitError` to identify instances of `ServerkitError` and its subclasses.
  - Added unit tests for `ServerkitError` to validate functionality and ensure proper subclassing behavior.

## 1.5.0

### Minor Changes

- 4e9ccf4: Update error handling and type overrides
  - Updated Kysely type overrides to include custom parsers for `INTERVAL` and `TINTERVAL`, improving PostgreSQL type handling.
  - Renamed `withErrors(errors)` to `withDetails(details)` in the errors package documentation for clarity.
  - Added a class decorator `OnPostgresError` to automatically map PostgreSQL errors to HTTP errors, enhancing error handling in services.
  - Enhanced tests for Kysely type overrides to cover new interval parsing functionality.
  - Added documentation for E.164 international phone number format in the utilities package.

## 1.4.0

### Minor Changes

- 922f585: upgrading to typescript 6

## 1.3.0

### Minor Changes

- 5ded700: updating tests

## 1.2.0

### Minor Changes

- 3f636dd: adding additional postgres error codes to be handled

## 1.1.0

### Minor Changes

- 8ab564a: refactored withErrors to withDetails to be more accurate

## 1.0.0

### Major Changes

- 2d69860: Initial release
