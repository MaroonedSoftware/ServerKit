---
'@maroonedsoftware/authentication': minor
---

`PhoneFactorService` now generates and verifies OTP codes for phone factor registration and adds a sign-in challenge flow that mirrors `EmailFactorService`. `registerPhoneFactor` now returns a `code` (the OTP to SMS to the user) and no longer returns `value`; `createPhoneFactorFromRegistration` now requires a third `code` argument and throws HTTP 400 when the code is invalid. New methods `issuePhoneChallenge`, `verifyPhoneChallenge`, and `hasPendingChallenge` provide a sign-in flow for existing active phone factors. The constructor now requires an `OtpProvider` dependency, and both `PhoneFactorServiceOptions` and `EmailFactorServiceOptions` gain an optional `tokenLength` (default `6`) that controls the length of generated OTP codes.

Migration: pass an `OtpProvider` to `PhoneFactorService`, drop the `value` from `registerPhoneFactor`'s destructure (the phone number is whatever you passed in), and forward the user-submitted code as the third argument to `createPhoneFactorFromRegistration`.
