---
'@maroonedsoftware/utilities': minor
'@maroonedsoftware/errors': minor
'@maroonedsoftware/kysely': minor
'@maroonedsoftware/koa': minor
---

Update error handling and type overrides

- Updated Kysely type overrides to include custom parsers for `INTERVAL` and `TINTERVAL`, improving PostgreSQL type handling.
- Renamed `withErrors(errors)` to `withDetails(details)` in the errors package documentation for clarity.
- Added a class decorator `OnPostgresError` to automatically map PostgreSQL errors to HTTP errors, enhancing error handling in services.
- Enhanced tests for Kysely type overrides to cover new interval parsing functionality.
- Added documentation for E.164 international phone number format in the utilities package.
