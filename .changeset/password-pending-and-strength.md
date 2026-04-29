---
'@maroonedsoftware/authentication': minor
---

Add `hasPendingRegistration`, `checkStrength`, and `ensurePasswordStrength` to `PasswordFactorService`. `hasPendingRegistration` mirrors the email/phone/authenticator factor services for staged-registration UI flows. `checkStrength` and `ensurePasswordStrength` are pass-throughs to the injected `PasswordStrengthProvider` so callers can surface live strength feedback (e.g. a sign-up form meter) without taking a separate dependency on the provider.
