---
'@maroonedsoftware/authentication': minor
---

OIDC factor: per-request authorize parameters, authentication claims on the profile, and a `step-up` intent.

- `OidcFactorService.beginAuthorization` takes optional `authorizeParams` (`login_hint`, `max_age`, `prompt`, `acr_values`), merged over the provider's configured `authorizeParams` for that request. Only those keys are forwarded, so a request cannot override `state`, `nonce`, PKCE, `redirect_uri`, or `scope`.
- When the effective request carries `max_age`, it is kept with the state and enforced on the callback through openid-client's `maxAge` check: the id_token must carry an `auth_time` within the window.
- `OidcProfile` gains `amr?: string[]`, `acr?: string`, and `authTime?: DateTime`, read from the merged id_token and userinfo claims.
- New `intent: 'step-up'` (requires `actorId`). `completeAuthorization` answers the new `kind: 'stepped-up'` when the identity is a factor of that actor, without linking, creating, or updating anything, and throws a 403 otherwise. Audited as `oidc.stepped_up` and `oidc.step_up.rejected`.

Existing callers are unaffected at runtime. A TypeScript `switch` on `result.kind` that asserts exhaustiveness needs a `'stepped-up'` case.
