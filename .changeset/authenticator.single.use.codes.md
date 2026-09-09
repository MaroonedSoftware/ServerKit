---
'@maroonedsoftware/authentication': minor
---

Make authenticator codes single-use. `AuthenticatorFactorService.validateFactor` previously never
advanced an HOTP factor's stored counter, so an HOTP code stayed valid indefinitely, and had no
replay guard for TOTP, so a code could be reused inside its drift window. HOTP factors now have
their counter advanced past the step that matched, and consumed TOTP steps are claimed in cache
with a set-if-absent write.

**Breaking for repository implementers:** `AuthenticatorFactorRepository` gains a required
`updateFactorCounter(actorId, factorId, counter)` method.

Also adds `OtpProvider.validateWithCounter`, which validates a code and reports which counter or
time step matched, and fixes a `RangeError` thrown out of `validate` when a submitted code was the
right number of characters but a different number of bytes.
