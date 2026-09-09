---
'@maroonedsoftware/authentication': patch
---

Mask recovery channel labels. `RecoveryOrchestrator.initiateRecovery` is reachable
pre-authentication, and previously returned the account's full email addresses and phone numbers
as `eligibleChannels[].label`, so anyone who knew one identifier could read the others. Labels are
now masked with the new `maskEmail` and `maskPhone` helpers; the unmasked recipient is still
returned by `issueChannelChallenge` for delivery.
