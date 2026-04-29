---
'@maroonedsoftware/authentication': minor
---

`AuthenticationSessionService.issueTokenForSession` now embeds session claims under a single nested `claims` object inside the JWT payload instead of spreading them onto the top-level payload. This avoids accidental collisions with reserved JWT fields, but consumers that decode the token directly and read claim keys off `jwtPayload.<claim>` must move to `jwtPayload.claims.<claim>`. Internal usage via `lookupSessionFromJwt` and `AuthenticationContext.claims` is unaffected (claims are read from the session, not the token).
