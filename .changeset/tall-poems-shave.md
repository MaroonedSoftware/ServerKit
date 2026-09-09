---
'@maroonedsoftware/authentication': minor
---

Give each email verification method its own pending-challenge slot, so an OTP and a magic link can
be outstanding for the same factor at once.

`EmailFactorService` cached the pending sign-in challenge under an `actorId_factorId` lookup key,
which is what makes `issueEmailChallenge` idempotent. That key ignored the verification method, so
a factor could only hold one pending challenge of either kind. An actor with a pending OTP who then
asked for a magic link got the OTP challenge back with `alreadyIssued: true`, and the magic link
email went out carrying a six digit code — and the reverse sent a link where a code was expected.

The lookup key is now `actorId_factorId_verificationMethod`. Each method has its own slot, so
`alreadyIssued` is answered per method, and redeeming or locking out a challenge under one method
leaves the other method's pending challenge untouched.

`verifyEmailChallenge(challengeId, code, method?)` takes an optional expected method and throws
HTTP 404 `{ challengeId: 'not found' }` when the stored challenge was issued under the other one.
The check runs before the factor lookup and the code check, so a cross-method probe neither
consumes a verification attempt nor reveals whether the factor is active. Omitting `method` accepts
either, as before. The email variants of `FactorChallengeProof` and `RecoveryProof` gained a
matching optional `issueMethod` that `MfaOrchestrator` and `RecoveryOrchestrator` forward to it, so
a route serving a single flow can state which method it expects.

The cache key shape changed, so a challenge issued by the previous version is not found by the
lookup that answers `alreadyIssued` and will be reissued once. It still verifies normally by
challenge id.
