---
'@maroonedsoftware/authentication': minor
---

Revoke a user's existing sessions after a password reset or full recovery. Previously
`RecoveryOrchestrator.completeRecovery` left prior authentication sessions working, and the caller
had to enumerate and delete them; a caller who missed that step left tokens minted before the
recovery valid.

Adds `AuthenticationSessionService.revokeAllForSubject(subject, reason?)`, a new `'recovery'`
member of `SessionRevocationReason`, and an optional `AuthenticationSessionService` constructor
dependency on `RecoveryOrchestrator`. When it is bound, `resetPassword` and `fullRecovery` revoke
the actor's sessions automatically; without it the previous behaviour is unchanged.
