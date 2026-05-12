---
'@maroonedsoftware/authentication': minor
---

`DefaultMfaRequiredPolicy` now treats email and OIDC as eligible second factors
when the primary factor used a different method. The old rule
unconditionally excluded `'oidc'` and `'email'`; the new rule excludes any
factor whose `method` matches the primary's `method`. This enables email-OTP
step-up after a password primary (previously: no MFA prompt) and keeps the
"never ask for the same method twice" guarantee for email-after-email and
oidc-after-oidc flows.

Behavior change for consumers using the default policy: a password-primary
actor with an email or OIDC factor on file will now be challenged for MFA
where they previously bypassed it. Conversely, an actor whose only second
factor is the same `method` as their primary (e.g. two FIDO keys, used one
as primary) will skip MFA where they previously had it. Subclass
`DefaultMfaRequiredPolicy` if you need to rule out specific methods
unconditionally or restore the previous behavior.
