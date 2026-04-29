---
'@maroonedsoftware/authentication': major
---

Align registration flows across factor services and decouple registration from actor binding.

- `PhoneFactorService.registerPhoneFactor` no longer takes `actorId` (only `value` and an optional caller-supplied `registrationId`). Phone registrations are now keyed by phone number alone; the actor is bound at completion time. The "already registered as a factor" 409 check has been removed — callers that need uniqueness should enforce it before completing the registration.
- `AuthenticatorFactorService.registerAuthenticatorFactor` is now idempotent: repeat calls for the same actor (or supplied `registrationId`) return the cached secret/uri/qrCode and `alreadyRegistered: true`. The return type now includes `issuedAt` and `alreadyRegistered`.
- `AuthenticatorFactorService.createAuthenticatorFactorFromRegistration`, `PhoneFactorService.createPhoneFactorFromRegistration` now return the persisted factor instead of just the factor id, and clear their cached registration entries on success. `PhoneFactor`'s registration-mismatch 400 has been removed (the registration no longer tracks the actor).
- `EmailFactorService.registerEmailFactor` and `PasswordFactorService.registerPasswordFactor` accept an optional caller-supplied `registrationId` for deterministic idempotent retries.
