---
'@maroonedsoftware/authentication': minor
---

Replace `callbackUrl: URL` with `params: AuthorizationCallbackParams` on `OAuth2FactorService.completeAuthorization` and `OidcFactorService.completeAuthorization`. Callers parse the standardized OAuth 2.0 / OIDC authorization-response payload (RFC 6749 §4.1.2, RFC 9207 `iss`) once at the HTTP boundary — typically `Object.fromEntries(ctx.query)` — and pass it through. The shape mirrors `URLSearchParams` entries: standard fields (`code`, `state`, `error`, `error_description`, `error_uri`, `iss`) are typed, and the index signature preserves provider-specific extras (Google `hd` / `authuser`, Microsoft `session_state`, etc.) without re-shaping.

Both services now also:

- Handle the `error` response (RFC 6749 §4.1.2.1) explicitly — throws `httpError(400)` with the IdP's `error` / `error_description` / `error_uri` in the response details instead of falling through as "missing state".
- (OIDC only) Verify `iss` against the discovered issuer (RFC 9207) when the caller supplies it. Mismatch throws `httpError(400)`.

Add a `'oauth2.profile.allowed'` / `'oidc.profile.allowed'` policy hook for provider-specific gating (Workspace `hd` enforcement, sub allowlists, claim-driven rules). Each factor service injects `PolicyService` and calls `check` after the verified profile is built; consumers register a subclass of the bundled `OAuth2ProfileAllowedPolicy` / `OidcProfileAllowedPolicy` (both default to allow-all) to add their own rules. Mirrors the existing `'email.allowed'` pattern. The default policies must be registered at DI bootstrap — `AuthenticationPolicyMappings` now includes both names so spreading it into your `PolicyRegistryMap` covers the new hooks.

Breaking changes:

- `OAuth2FactorService.completeAuthorization({ callbackUrl })` → `completeAuthorization({ params })`.
- `OidcFactorService.completeAuthorization({ callbackUrl })` → `completeAuthorization({ params })`.
- `OAuth2FactorService` and `OidcFactorService` constructors gain a trailing `PolicyService` parameter; `'oauth2.profile.allowed'` and `'oidc.profile.allowed'` must be registered (the bundled default policies allow-all).
