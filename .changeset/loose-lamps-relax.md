---
'@maroonedsoftware/authentication': minor
---

feat: implement injectable abstract classes for authentication factors

- Added @Injectable() decorator to AuthenticatorFactorRepository, EmailFactorRepository, PasswordFactorRepository, and PhoneFactorRepository, enabling dependency injection.
- Updated the structure of the repository classes to support better integration with the dependency injection framework.
