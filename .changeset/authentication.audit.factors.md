---
'@maroonedsoftware/authentication': minor
---

Emit audit events for the email, phone, and authenticator factors: challenge issue, verification,
failure, lockout, and factor creation and removal.

An email or phone challenge verification is a login in its own right, not merely an address
confirmation, so those events are categorised as such. A challenge abandoned after too many wrong
codes gets its own event rather than another failure, because the challenge is destroyed rather than
merely refused and the rate is worth alerting on.

`authenticator.validation.replayed` is separate from an invalid code. A correct-but-replayed code
inside the drift window means someone observed a valid one, which is interception rather than a
typo. Authenticator enrolment and removal are privilege changes rather than credential changes,
since they move the assurance every future session can reach.

A cross-method email probe is recorded under its real reason even though the caller is told "not
found": the anti-probing response is for the client, not for the audit trail.

No code, magic-link token, TOTP secret, provisioning URI, or QR code reaches an event, though all
three of those last carry the secret and the services return them to their callers for delivery.
