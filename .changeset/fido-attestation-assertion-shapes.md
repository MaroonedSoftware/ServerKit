---
'@maroonedsoftware/authentication': minor
---

`FidoFactorService` registration and challenge results now nest the WebAuthn payload under a single `attestation`/`assertion` key so callers can forward it directly to `navigator.credentials.create`/`get` without spreading.

- `registerFidoFactor` now returns `{ registrationId, attestation: { rp, user, challenge, pubKeyCredParams, timeout, attestation }, expiresAt, issuedAt, alreadyRegistered }`. The previous `attestationOptions` / top-level `user` / `challenge` / `attestation` (conveyance) fields are gone.
- `createFidoAuthorizationChallenge` now returns `{ challengeId, assertion: { ...assertionOptions, challenge, allowCredentials }, expiresAt, issuedAt, alreadyIssued }`. The previous `assertionOptions` / top-level `challenge` / `allowCredentials` fields are gone.

Migration: replace `result.attestationOptions` / `result.user` / `result.challenge` / `result.attestation` with `result.attestation.<field>`, and `result.assertionOptions` / `result.challenge` / `result.allowCredentials` with `result.assertion.<field>`.
