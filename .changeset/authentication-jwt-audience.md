---
'@maroonedsoftware/authentication': minor
---

Verify the JWT `aud` (audience) claim on incoming tokens.

The package signed an `aud` claim on issued tokens but never asserted it on the way in, so a token minted for a different audience (with the same issuer and signing key) was accepted for both access and refresh flows. `JwtProvider.decode` now takes an optional trailing `audience` parameter that it passes to `jsonwebtoken.verify`, and `AuthenticationSessionService` threads the audience configured on `AuthenticationSessionServiceOptions` into both `lookupSessionFromJwt` (access-token validation) and `refreshSession` (refresh-token validation). A token whose `aud` does not match the configured audience is now rejected with a 401.

Fully backward-compatible: `audience` is optional and defaults to not-checking, so deployments that never configured an audience keep working unchanged. RS256 algorithm pinning and existing issuer/expiry behavior are preserved. Consumers that already pass an `audience` to `AuthenticationSessionServiceOptions` gain enforcement automatically with no code change.
