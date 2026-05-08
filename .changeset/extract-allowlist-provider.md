---
'@maroonedsoftware/authentication': minor
---

Extract email and phone factor allow/deny rules into a new injectable `AllowlistProvider`. `EmailFactorServiceOptions` no longer accepts a `denyList`; configure `AllowlistProviderOptions` with `emailDomainDenyList` instead. `EmailFactorService` and `PhoneFactorService` constructors now take a required `AllowlistProvider`. Subclass `AllowlistProvider` to plug in stricter validation (regional phone filtering, dynamic deny lists, MX checks, etc.) without touching the factor services.
