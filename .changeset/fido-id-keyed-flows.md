---
'@maroonedsoftware/authentication': minor
---

`FidoFactorService` now mirrors the registration/sign-in shape of the email and phone services, with idempotent flows keyed by ids:

- `registerFidoFactor` returns `{ registrationId, attestationOptions, user, challenge, attestation, expiresAt, issuedAt, alreadyRegistered }` instead of a `FidoAttestation`, and accepts an optional caller-supplied `registrationId`. Calling it again for the same actor (or the same `registrationId`) returns the cached payload with `alreadyRegistered: true`.
- `createFidoFactorFromRegistration(actorId, registrationId, credential)` now requires `registrationId` and throws HTTP 404 (was HTTP 401 `invalid_registration`) when the registration is missing or expired.
- `createFidoAuthorizationChallenge(actorId, factorId, options?)` takes a new `factorId` parameter. When provided, the challenge is scoped to that single factor and the verifier enforces that the credential belongs to it. When omitted, all of the actor's active factors are eligible. The return shape is now `{ challengeId, assertionOptions, challenge, allowCredentials, expiresAt, issuedAt, alreadyIssued }`, and back-to-back calls for the same `(actorId, factorId)` return the cached challenge.
- `verifyFidoAuthorizationChallenge(challengeId, credential)` is keyed by `challengeId` (was `actorId`). It now throws HTTP 404 when the challenge is missing/expired, and HTTP 401 with `error="invalid_factor"` when the credential does not belong to the scoped factor.
- New `hasPendingRegistration(registrationId)` and `hasPendingChallenge(challengeId)` helpers.
- `FidoFactorRepository` adds a new `lookupFactor(actorId, credentialId)` method (the credential-id lookup that `getFactor` previously did); `getFactor(actorId, factorId)` is now keyed by the factor row id.

Migration: thread the new `registrationId` and `challengeId` values through your client/server roundtrip, pass `factorId` (or `undefined`) to `createFidoAuthorizationChallenge`, and add `lookupFactor` to your `FidoFactorRepository` implementation.
