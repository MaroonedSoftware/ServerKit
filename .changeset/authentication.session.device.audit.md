---
'@maroonedsoftware/authentication': minor
---

Carry device metadata on session audit events. `AuditSessionData` gains the same optional `device`
block, filled from the session in `auditSessionData` — the single funnel feeding every session event
that carries session detail, so `session.created`, `updated`, `rotated`, `refreshed` and both
`revoked` paths gain it at once.

This is the useful half. A revoke or a refresh arrives on a different request than the login, where
the live context describes a different caller, so the origin has to come off the session rather than
the request. That is precisely what both ServerKit consumers were using session claims to achieve.

A session without a device produces an event without the block, rather than one carrying empty
strings.

The `AuditSessionData.claims` doc comment no longer explains the passthrough by pointing at that
workaround. The passthrough stays, since an application may legitimately stamp other things on a
session, but `device` is now the way to record where a session came from.
