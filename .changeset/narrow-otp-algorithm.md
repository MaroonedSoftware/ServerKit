---
'@maroonedsoftware/authentication': minor
---

Narrow `OtpOptions.algorithm` from `string` to the union `'sha1' | 'sha256' | 'sha512'` and lowercase the default in `OtpProvider`, `AuthenticatorFactorServiceOptions.defaults`, and `SupportVerificationCodeServiceOptions.defaults`. `OtpProvider.generateURI` still emits the uppercase algorithm in the otpauth URI per spec, so existing provisioned secrets and authenticator apps are unaffected at runtime. Callers passing uppercase string literals (`'SHA1'`, `'SHA256'`, `'SHA512'`) must lowercase them.
