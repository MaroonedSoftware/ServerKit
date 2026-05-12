# @maroonedsoftware/policies

## 0.3.0

### Minor Changes

- ab8e734: Split policy denial results into client-facing vs operator-only payloads so
  hint data reaches the wire.
  - `PolicyResultDenied` gains an optional `internalDetails` field alongside
    `details`. `details` is now explicitly the client-facing payload; rendered
    to the HTTP response body by `BasePolicyService.assert`. `internalDetails`
    carries operator/log-only context and is attached to the thrown error's
    `internalDetails`, never on the wire.
  - `Policy.deny(reason, details?, internalDetails?)` gains the third positional
    parameter so policy authors can choose per-call which bucket each piece of
    data lives in.
  - `BasePolicyService.assert` now maps `result.details` → `HttpError.details`
    (so the koa error middleware renders it) and merges `result.internalDetails`
    with the framework's `{ policyName, reason, kind: 'policy_violation' }` under
    `HttpError.internalDetails`. Previously every denial — including step-up,
    MFA-required, and password-strength hints — was buried under
    `internalDetails` and never reached the client.

  Behavior change for downstream policies: any policy that already calls
  `denyStepUp(...)` or `deny(reason, payload)` will start surfacing `payload`
  to clients on 403 responses. This matches the documented contract for
  `PolicyResultDenied.details` and unblocks clients that need to drive
  re-auth modals, MFA factor pickers, or password-strength UI from the 403
  response.

## 0.2.0

### Minor Changes

- ae918b6: Reshape `StepUpRequirement.withinSeconds: number` to `StepUpRequirement.within: Duration` so step-up windows are expressed in the same Luxon `Duration` shape used everywhere else in ServerKit (factor expirations, session TTLs, …) and don't require callers to convert between units at the call site.

  Migration: replace `withinSeconds: 300` with `within: Duration.fromObject({ minutes: 5 })` (or any equivalent `Duration`).

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
