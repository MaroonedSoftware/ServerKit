---
'@maroonedsoftware/authentication': minor
---

`FidoFactorServiceOptions` gains optional `rpId`, `rpName`, `rpOrigin`, and `rpIcon` defaults (defaulting to `localhost`/`Localhost`/`http://localhost`). The corresponding fields on `RegisterFidoFactorOptions` and `AuthorizeFidoFactorOptions` are now optional and fall back to those defaults, and `createFidoAuthorizationChallenge` may be called without an `options` argument. Existing callers that pass `rpId`/`rpName`/`rpOrigin` per call continue to work unchanged.
