---
'@maroonedsoftware/errors': minor
---

feat: introduce ServerkitError class for enhanced error handling

- Added `ServerkitError` as a base class for non-HTTP errors, providing `details`, `cause`, and `internalDetails` properties with fluent setters.
- Updated `HttpError` to extend `ServerkitError`, inheriting its features while adding HTTP-specific properties.
- Enhanced README documentation to include usage examples for `ServerkitError` and its integration with `HttpError`.
- Implemented type guard `IsServerkitError` to identify instances of `ServerkitError` and its subclasses.
- Added unit tests for `ServerkitError` to validate functionality and ensure proper subclassing behavior.
