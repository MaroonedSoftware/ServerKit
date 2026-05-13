# @maroonedsoftware/policies

## 0.4.0

### Minor Changes

- b506f37: Replace `requireSecurity` with a policy-driven `requirePolicy` middleware,
  and let policies attach HTTP headers to their denial results.

  ### `@maroonedsoftware/policies`
  - `PolicyResultDenied` gains an optional `headers?: Record<string, string>`
    field, forwarded to `HttpError.withHeaders` by `BasePolicyService.assert`.
  - `Policy.deny(...)` and `Policy.denyStepUp(...)` now return a
    `PolicyDenialBuilder` (still assignable to `PolicyResultDenied`) with a
    fluent `.withHeaders(headers)` setter:

    ```ts
    return this.deny('mfa_required').withHeaders({ 'WWW-Authenticate': 'Bearer error="mfa_required"' });
    ```

    Use for `WWW-Authenticate` on auth/MFA policies, `Retry-After` on
    rate-limit policies, etc.

  ### `@maroonedsoftware/authentication`
  - **New `DefaultMfaSatisfiedPolicy`** (`'auth.session.mfa.satisfied'`).
    Gate-style rule consulted by koa's new `requirePolicy()`: allows when the
    session has at least two factors and at least one is not of
    `kind: 'knowledge'`. Denies with
    `WWW-Authenticate: Bearer error="mfa_required"`. Distinct from
    `'auth.session.mfa.required'` — that policy answers "primary just
    succeeded, is a different secondary required?" during the orchestrator
    handoff; this one answers "is this session as-it-stands MFA-satisfied?"
    for route gating. Subclass to grant MFA credit to single-factor sessions
    whose underlying method delegates MFA elsewhere (e.g. `oidc` from an IdP
    that enforces 2FA upstream).
  - The existing default policies — `DefaultMfaRequiredPolicy`,
    `DefaultRecentFactorPolicy`, `DefaultAssuranceLevelPolicy` — now attach
    `WWW-Authenticate` headers on deny (`mfa_required`, `step_up_required`,
    `aal1_required` / `aal2_required` respectively) so SPAs can detect
    re-auth-required responses the same way they detect 401s.
  - `AuthenticationPolicyMappings` and `AuthenticationPolicyContexts` gain
    the new `'auth.session.mfa.satisfied'` entry.

  ### `@maroonedsoftware/koa`
  - **Breaking:** `requireSecurity` is removed.
  - **New `requirePolicy(options?)`** router middleware. Validates the
    session, then resolves `PolicyService` from `ctx.container` and calls
    `policyService.assert(options.policy ?? 'auth.session.mfa.satisfied', { session })`.
    Routes can opt into any registered policy by name (MFA, AAL2 step-up,
    recent-factor step-up, custom) without a codegen change. Pass
    `{ policy: false }` to validate the session only.
  - `@maroonedsoftware/policies` is now a direct dependency.

  #### Migration

  | Old                                      | New                                |
  | ---------------------------------------- | ---------------------------------- |
  | `requireSecurity({ requireMfa: true })`  | `requirePolicy()`                  |
  | `requireSecurity({ requireMfa: false })` | `requirePolicy({ policy: false })` |
  | `requireSecurity()` (default)            | `requirePolicy()`                  |

  Status code on MFA-denied requests changes from **401** to **403** (the
  policy framework's standard for "authenticated but not allowed"). The
  `WWW-Authenticate: Bearer error="mfa_required"` header is preserved on the
  new 403 so SPAs that gate re-auth on the header keep working.

  To grant MFA credit to OIDC sessions (or any single-factor session whose
  method delegates MFA upstream), register a custom policy at bootstrap:

  ```ts
  @Injectable()
  class OidcAwareMfaSatisfiedPolicy extends Policy<AuthMfaSatisfiedPolicyContext> {
    async evaluate({ session }) {
      if (session.factors.some(f => f.method === 'oidc')) return this.allow();
      if (session.factors.length >= 2 && !session.factors.every(f => f.kind === 'knowledge')) {
        return this.allow();
      }
      return this.deny('mfa_required').withHeaders({ 'WWW-Authenticate': 'Bearer error="mfa_required"' });
    }
  }

  registry.register(PolicyRegistryMap).useMap().add('auth.session.mfa.satisfied', OidcAwareMfaSatisfiedPolicy);
  ```

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
