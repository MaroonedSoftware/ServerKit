---
'@maroonedsoftware/authentication': minor
---

Consume the remaining single-use cache entries atomically with `CacheProvider.take`, so two concurrent requests can no longer both redeem one entry:

- `OAuth2FactorService`: the state record and the pending `new-user` authorization.
- `RecoveryChallengeService.redeem` and `RecoverySessionService.redeem`.
- `AuthorizationCodeService.redeem` (already guarded by its consumed marker; the read and delete are now one call).
- Password and FIDO registrations, and the phone, email and FIDO challenge verifications. These still check the code or credential first, so a wrong guess only costs an attempt. The `take` then decides which of two concurrent correct submissions wins. The loser gets a 404, or a 401 `invalid_credentials` for FIDO.

`PkceProvider` gains `takeChallenge` and `takeVerifier`, which read and delete an entry in one step. Use them instead of `getVerifier` followed by `deleteVerifier`, which two concurrent token requests can both pass.
