---
'@maroonedsoftware/authentication': minor
---

Rename the bundled policy names from `'email_allowed'` / `'phone_allowed'` to `'email.allowed'` / `'phone.allowed'` to use a dotted naming convention that reads better as a namespace and matches the convention `AuthenticationPolicyMappings` will use going forward. `EmailFactorService` and `PhoneFactorService` now call `policyService.check('email.allowed', ...)` and `policyService.check('phone.allowed', ...)` respectively.

Migration: in your `PolicyRegistryMap` setup, change `map.set('email_allowed', EmailAllowedPolicy)` to `map.set('email.allowed', EmailAllowedPolicy)` and `map.set('phone_allowed', PhoneAllowedPolicy)` to `map.set('phone.allowed', PhoneAllowedPolicy)`. If you depend on `AuthenticationPolicyNames` / `AuthenticationPolicyContexts` directly, the keys in those types change accordingly.
