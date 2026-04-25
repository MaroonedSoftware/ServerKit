---
'@maroonedsoftware/authentication': minor
---

fix: correct email existence check in EmailFactorService

- Updated the condition in the registerEmailFactor method to throw a 409 error when an email already exists.
- Adjusted the corresponding unit test to reflect the change in logic, ensuring it now tests for the correct scenario where an email is already registered.
