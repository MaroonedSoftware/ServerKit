---
'@maroonedsoftware/kysely': minor
---

Enhance Kysely type overrides with TSTZRANGE support

- Added support for PostgreSQL `TSTZRANGE` type in Kysely type overrides, mapping it to Luxon `Interval`.
- Updated documentation to reflect the new type mappings and custom parsers.
- Enhanced tests to cover parsing functionality for `TSTZRANGE`, ensuring correct handling of various timestamp formats.
