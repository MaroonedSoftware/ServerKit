---
'@maroonedsoftware/authentication': minor
---

Add OpenID Connect and OAuth 2.0 authentication factors.

The new `OidcFactorService` (backed by `openid-client`) and `OAuth2FactorService` (adapter-based, recommended pairing with `arctic`) cover SSO sign-in, account linking, and refresh-token rotation:

- Single-step `beginAuthorization` / `completeAuthorization` flow that mirrors the email-factor pattern.
- Per-provider config via `OidcProviderRegistry` / `OAuth2ProviderRegistry` (Google, LinkedIn, Microsoft for OIDC; GitHub, Discord, Twitter/X for OAuth 2.0).
- Public-client support — omit `clientSecret` and the OIDC service falls back to `None()` client auth with mandatory PKCE.
- Optional refresh-token persistence (envelope-encrypted via `@maroonedsoftware/encryption`), opt-in per provider with `persistRefreshToken: true`.
- Auto-link by verified email via the `OidcActorEmailLookup` / `OAuth2ActorEmailLookup` interfaces apps implement to bridge to their existing account store. Unverified email matches surface as `kind: 'new-user'` with an `emailConflict` discriminant so UIs can require sign-in to the existing account before linking.
