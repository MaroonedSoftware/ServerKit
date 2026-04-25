---
'@maroonedsoftware/authentication': minor
---

feat: add actorId to authentication factors

- Added actorId property to AuthenticatorFactor, EmailFactor, PasswordFactor, and PhoneFactor interfaces to associate factors with their respective actors.
- Updated createFactor method in EmailFactorRepository to remove the verificationMethod parameter.
- Adjusted related tests to reflect these changes, ensuring consistency across the authentication factors.
