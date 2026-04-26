---
'@maroonedsoftware/authentication': minor
---

refactor: update authentication session handling to use Luxon DateTime

- Changed session and factor timestamps from Unix integers to Luxon DateTime instances for improved date handling.
- Updated serialization and deserialization methods to convert DateTime to Unix integers at the cache boundary.
- Enhanced README documentation to reflect changes in session structure and data types.
- Adjusted unit tests to accommodate new DateTime handling in session management.
