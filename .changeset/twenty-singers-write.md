---
'@maroonedsoftware/authentication': minor
'@maroonedsoftware/encryption': minor
---

feat: implement PKCE support in authentication package

- Introduced `PkceProvider` for cache-backed storage of PKCE state, enabling OAuth 2.0 PKCE flows.
- Updated `EmailFactorService` and `PhoneFactorService` to return `alreadyRegistered` flag for pending registrations, improving user experience by preventing duplicate notifications.
- Enhanced README documentation with PKCE usage examples and details.
- Added unit tests for `PkceProvider` and updated existing tests for email and phone factor services to cover new functionality.
