---
'@maroonedsoftware/authentication': patch
---

`DefaultMfaRequiredPolicy` now excludes `oidc` factors from the MFA second-factor list regardless of the primary method. Federated sign-in is opaque about its own MFA and a second IdP account is typically controlled by the same user, so it shouldn't count as an independent factor. Previously, an `oidc` factor could surface as eligible whenever the primary used a different method (e.g. password).
