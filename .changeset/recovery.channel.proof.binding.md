---
'@maroonedsoftware/authentication': patch
---

Bind recovery channel proofs to the parent recovery challenge. `RecoveryOrchestrator.verifyChannel`
now requires an email or phone proof to carry the `channelChallengeId` that `issueChannelChallenge`
stitched onto the challenge, and requires the verified factor to appear in the challenge's
`eligibleChannels`. Previously a sub-challenge issued against the caller's own factor could be
redeemed against a recovery challenge bound to a different actor, minting that actor's recovery
session with `resetPassword` granted.
