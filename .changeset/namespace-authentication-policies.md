---
'@maroonedsoftware/authentication': minor
---

Rename the 10 bundled policy identifiers in `@maroonedsoftware/authentication` so every name lives under a single `auth.*` namespace, with sub-namespaces grouping related policies (`auth.factor.*` for input/profile gating, `auth.session.*` for session-state assertions, `auth.recovery.*`, `auth.support.*`). The class names exported from the package (`EmailAllowedPolicy`, `MfaRequiredPolicy`, …) are unchanged — only the string identifiers used to register against `PolicyService` change.

Migration: update your `PolicyRegistryMap` wiring and any type maps you extend from `AuthenticationPolicyNames` / `AuthenticationPolicyContexts`:

| Old | New |
| --- | --- |
| `'email.allowed'` | `'auth.factor.email.allowed'` |
| `'phone.allowed'` | `'auth.factor.phone.allowed'` |
| `'password.allowed'` | `'auth.factor.password.allowed'` |
| `'oidc.profile.allowed'` | `'auth.factor.oidc.profile.allowed'` |
| `'oauth2.profile.allowed'` | `'auth.factor.oauth2.profile.allowed'` |
| `'auth.mfa.required'` | `'auth.session.mfa.required'` |
| `'auth.recent.factor'` | `'auth.session.recent.factor'` |
| `'auth.assurance.level'` | `'auth.session.assurance.level'` |
| `'recovery.allowed'` | `'auth.recovery.allowed'` |
| `'support.verification.allowed'` | `'auth.support.verification.allowed'` |

Consumers that spread `AuthenticationPolicyMappings` into their registry pick up the new names automatically; consumers that registered policies by name explicitly (`map.set('email.allowed', EmailAllowedPolicy)`) must update each `set` call. The `AuthenticationPolicyNames` union is a string-literal type, so the TypeScript compiler will flag every stale reference.
