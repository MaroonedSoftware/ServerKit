---
'@maroonedsoftware/authentication': minor
---

feat: add pending registration and challenge checks for authentication factors

- Introduced `hasPendingRegistration` method in Authenticator, Email, and Phone factor services to verify if a registration is cached and unexpired.
- Added `hasPendingChallenge` method in Email factor service to check for cached challenges.
- Updated documentation to reflect new methods and their usage.
- Enhanced unit tests to cover the new functionality for pending registrations and challenges across all factor services.
