---
'@maroonedsoftware/authentication': minor
---

Add `OidcProviderConfig.allowInsecureIssuer` to permit `http://` issuer URLs against a local IdP (docker-compose Keycloak, etc.) by wiring `openid-client`'s `allowInsecureRequests` execute hook into discovery. A warning is logged whenever the flag is enabled — including on `https://` issuers where it has no effect — so it doesn't get left on by accident. Do not enable in production.

`OidcProviderRegistry` now also takes a `Logger` as its second constructor argument (used for the warning above). DI users with a `Logger` registered are unaffected; consumers constructing the registry directly need to pass one.
