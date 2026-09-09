---
'@maroonedsoftware/authentication': patch
---

Make MFA completion atomic and check eligibility before the proof is spent.
`MfaOrchestrator.completeMfa` previously verified the proof before checking it against the
challenge's eligible list, so a proof aimed at a factor the challenge never offered still consumed
the single-use sub-challenge behind it. It also ran `peek` then `redeem` non-atomically, so two
concurrent completions for the same challenge could both succeed.

The method (and an authenticator proof's `methodId`) is now checked up front, one completion runs
at a time per challenge (a concurrent second call gets a 409, and the lock is released when a proof
fails so the actor can retry), and `MfaChallengeService.redeem` treats the delete as the claim so
only one caller wins.
