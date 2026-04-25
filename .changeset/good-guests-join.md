---
'@maroonedsoftware/authentication': minor
---

refactor: convert expiresAt to DateTime in Email and Phone factor services

- Updated the EmailFactorService and PhoneFactorService to return expiresAt as a DateTime object instead of a raw timestamp.
- Adjusted unit tests for both services to validate the type of expiresAt and ensure it matches the expected value.
