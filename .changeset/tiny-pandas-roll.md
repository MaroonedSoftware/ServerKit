---
'@maroonedsoftware/authentication': minor
---

refactor: update authentication session handling to use Luxon DateTime and rename session token handling in authentication package

- Changed session and factor timestamps from Unix integers to Luxon DateTime instances for improved date handling.
- Updated serialization and deserialization methods to convert DateTime to Unix integers at the cache boundary.
- Enhanced README documentation to reflect changes in session structure and data types.
- Adjusted unit tests to accommodate new DateTime handling in session management.
- Updated the naming of session token properties from `token` to `sessionToken` for clarity and consistency across the authentication module.
- Adjusted methods and documentation to reflect the new naming convention, including `issueTokenForSession` and related session management functions.
- Modified unit tests to ensure compatibility with the updated session token structure.
