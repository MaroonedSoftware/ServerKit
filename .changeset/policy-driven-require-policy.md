---
'@maroonedsoftware/policies': minor
'@maroonedsoftware/authentication': minor
'@maroonedsoftware/koa': minor
---

Replace `requireSecurity` with a policy-driven `requirePolicy` middleware,
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

| Old | New |
|---|---|
| `requireSecurity({ requireMfa: true })` | `requirePolicy()` |
| `requireSecurity({ requireMfa: false })` | `requirePolicy({ policy: false })` |
| `requireSecurity()` (default) | `requirePolicy()` |

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
