---
'@maroonedsoftware/authentication': minor
---

Emit audit events for password verification, MFA orchestration, and account recovery. This is the
largest previously silent surface in the package: none of these operations recorded anything.

`password.verify.*` is the most important group, since it is where a login succeeds or fails. The
rate-limit refusal is its own event rather than a failure reason, because a wrong password is one
person mistyping while a burst of refusals is the lockout signal, and collapsing them hides that
burst. A forced reset and a missing factor are likewise distinct from a wrong password.

`mfa.challenge.skipped` records the gate deciding a second factor was not required. An auditor
reviewing an incident needs to see that decision, not only the cases where MFA was demanded and
satisfied. `mfa.failed` carries a reason that separates an ordinary rejected proof from the
defence-in-depth trips, which mean a pre-check was bypassed.

`recovery.initiated` without an `actorId` is a probe: the package deliberately issues a challenge
for an unknown identifier so a caller cannot enumerate accounts, so a run of those events is someone
testing addresses. `recovery.channel.rejected` names `sub_challenge_mismatch` specifically, which is
a proof issued against one account presented on another's challenge.

`recovery.sessions_not_revoked` fires when the orchestrator has no `AuthenticationSessionService`
bound, which silently leaves every pre-recovery token working. That misconfiguration had no visible
symptom before.

No secret reaches an event: no password, hash, one-time code, or magic-link token. Events are
emitted at the decision point rather than from a catch block, so a `failure` outcome always means a
credential verdict and never an infrastructure fault.
