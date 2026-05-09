---
'@maroonedsoftware/authentication': minor
---

Authenticator and FIDO factors gain an optional `label` field so callers can attach a human-readable name (e.g. "Personal phone", "MacBook Touch ID") to each factor.

- `AuthenticatorFactorService.registerAuthenticatorFactor` signature is now `(actorId, label?, options?, registrationId?)` — `label` is inserted as the second argument. Migration: existing calls of the form `registerAuthenticatorFactor(actorId, options)` must become `registerAuthenticatorFactor(actorId, undefined, options)`.
- `FidoFactorService.registerFidoFactor`'s `options.label` is forwarded to the new factor.
- `FidoFactorRepository.createFactor(actorId, options)` now takes a single `FidoFactorOptions` object instead of positional `(publicKey, publicKeyId, counter, active)` arguments. The `active` parameter is removed; implementations should default new factors to active. A new exported `FidoFactorOptions` type captures the persisted shape.
- `AuthenticatorFactor` and `FidoFactor` both gain an optional `label?: string` field.

The previously-stale `FidoAttestation` export has been removed.
