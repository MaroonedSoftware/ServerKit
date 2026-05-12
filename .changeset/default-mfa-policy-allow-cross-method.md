---
'@maroonedsoftware/authentication': minor
---

`DefaultMfaRequiredPolicy` now refines how it picks eligible second factors. A
factor disqualifies if it's a knowledge factor (a second password adds no MFA
value), if it's the exact same instance just used as primary (`methodId`
matches), or if it's an `email`/`oidc` factor whose method matches the
primary's (a different inbox or a different IdP isn't treated as a separate
authenticator by default). Possession factors backed by physical devices —
`fido`, `phone`, `authenticator` — qualify even when the primary used the
same method, as long as the `methodId` differs (e.g. two FIDO keys, two
phones).

The previous policy unconditionally excluded `'oidc'` and `'email'` as
second factors, which prevented common step-up flows like password →
email-OTP. The previous policy also didn't exclude same-instance matches,
which meant the primary factor could theoretically be reused as its own
second factor if the caller passed it in `availableFactors`.

Behavior change for consumers using the default policy:

- **Newly requires MFA**: password-primary actor with an email or OIDC
  factor on file (previously bypassed MFA; now challenged for email-OTP or
  OIDC step-up).
- **Newly requires MFA**: any actor with two of the same possession-method
  factor on file (two FIDO keys, two phones, two authenticator apps) — the
  second device now counts as a valid second factor.
- **Newly skips MFA**: the (rare) case where `availableFactors` echoed back
  the exact same factor used as primary — the `methodId` match now excludes
  it. Previously the orchestrator relied on the caller to dedupe.

Subclass `DefaultMfaRequiredPolicy` if you need to rule out specific methods
unconditionally or restore the previous behavior.
