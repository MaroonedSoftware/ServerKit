---
'@maroonedsoftware/koa': minor
---

`requireSecurity` now enforces multi-factor authentication by default. Routes guarded by `requireSecurity()` will throw 401 with `WWW-Authenticate: Bearer error="mfa_required"` unless the session has at least two factors and at least one factor is not of `kind: 'knowledge'`. Pass `requireSecurity({ requireMfa: false })` to opt out (e.g. for step-up MFA enrollment routes). The previously-reserved `roles` option has been removed.
