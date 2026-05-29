---
"@maroonedsoftware/authentication": minor
---

Persist the SSO profile `picture` on OIDC and OAuth2 factors. `OidcFactorValue`/`OAuth2FactorValue` gain an optional `picture?` field that's stored on `createFactor`, and the factor repositories gain an optional `updatePicture?(factorId, picture)` method called on re-auth when the provider reports a changed avatar (mirroring `updateEmail`). Non-breaking: repositories opt in by implementing `updatePicture` and adding a `picture` column; the re-auth update no-ops otherwise.
