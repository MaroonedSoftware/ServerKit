# @maroonedsoftware/policies

## 0.1.0

### Minor Changes

- b82c093: Extract email/phone allow rules into the new `@maroonedsoftware/policies` package.

  The new package introduces a small DI-friendly policy framework: a `Policy` base class with `allow()` / `deny(reason, details?)` / `denyStepUp(reason, requirement)` helpers, a discriminated `PolicyResult`, and a typed `PolicyService` (`check` / `assert`) that resolves named policies through a `PolicyRegistryMap`. Subclass `BasePolicyService` to supply a per-evaluation `PolicyEnvelope` (at minimum `now: DateTime`).

  Breaking changes in `@maroonedsoftware/authentication`:
  - `AllowlistProvider` and `AllowlistProviderOptions` are removed. Email/phone validation is now dispatched through `PolicyService` from `@maroonedsoftware/policies`.
  - `EmailFactorService` and `PhoneFactorService` constructors now take `PolicyService` (replacing `AllowlistProvider`).
  - New `EmailAllowedPolicy` (with `EmailAllowedPolicyOptions.emailDomainDenyList`) and `PhoneAllowedPolicy` ship in this package; register them under the policy names `'email_allowed'` and `'phone_allowed'` respectively. Bundled factor services call `policyService.check('email_allowed', { value })` and `policyService.check('phone_allowed', { value })`, then map the `reason` on a denial to HTTP 400 (same external behaviour as before for default consumers).

  Migration: replace the `AllowlistProvider` registration with bindings for `EmailAllowedPolicy` and `PhoneAllowedPolicy` plus a `PolicyService` (typically a `BasePolicyService` subclass) and a `PolicyRegistryMap` that maps `'email_allowed'` and `'phone_allowed'` to those policies. Move any `emailDomainDenyList` configuration from `AllowlistProviderOptions` to `EmailAllowedPolicyOptions`. Custom subclasses that returned non-default `reason` strings continue to work — the factor services pass unknown reasons through unchanged.

  Also exports `matchesFactorConstraints` and `isFactorRecent` helpers (groundwork for step-up policies).
