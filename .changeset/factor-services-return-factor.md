---
'@maroonedsoftware/authentication': major
---

Factor service verify/create/update/change methods now return the full factor object instead of just an id or `{ actorId, factorId }` pair. `EmailFactorService.verifyEmailChallenge` and `FidoFactorService.verifyFidoAuthorizationChallenge` also re-check that the matching factor is still active and throw HTTP 401 with `WWW-Authenticate: Bearer error="invalid_factor"` when it has been deleted or deactivated since the challenge was issued.

Affected methods:

- `AuthenticatorFactorService.validateFactor` now returns `AuthenticatorFactor` (was `void`).
- `EmailFactorService.verifyEmailChallenge` now returns `EmailFactor` (was `{ actorId, factorId }`).
- `FidoFactorService.createFidoFactorFromRegistration` now returns `FidoFactor` (was `string`).
- `FidoFactorService.verifyFidoAuthorizationChallenge` now returns `FidoFactor` (was `{ actorId, factorId }`); the unknown-credential branch now throws `error="invalid_factor"` instead of `error="invalid_credentials"`.
- `PasswordFactorService.createPasswordFactor`, `updatePasswordFactor`, `verifyPassword`, and `changePassword` now return `PasswordFactor` (was `string`).
