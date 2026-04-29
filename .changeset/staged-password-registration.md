---
'@maroonedsoftware/authentication': minor
---

Add a staged registration flow to `PasswordFactorService`. New methods `registerPasswordFactor(password)` and `createPasswordFactorFromRegistration(actorId, registrationId)` let callers stage a strength-checked, hashed password in the cache before the actor record exists, then bind it to the actor in a second step. Mirrors the existing email factor registration shape. The constructor now requires a `CacheProvider` (resolved automatically by the DI container).
