---
'@maroonedsoftware/authentication': minor
---

feat: introduce TypeScript configuration and refactor repository interfaces

- Added a new TypeScript configuration file for tests in the authentication package.
- Refactored repository classes for authenticator, email, password, and phone factors to use interfaces instead of abstract classes, improving clarity and flexibility.
- Updated import statements to use type imports where applicable, enhancing type safety and reducing unnecessary runtime overhead.
- Added unit tests for the password factor service to ensure functionality and robustness.
