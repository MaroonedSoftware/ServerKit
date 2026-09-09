---
'@maroonedsoftware/authentication': minor
---

Emit audit events for the session lifecycle and for API keys, and deprecate `AuthenticationSessionHooks`.

Session events cover creation, update, rotation, refresh, revocation, bulk revocation, family
teardown, refresh-token replay, and validation failure. Two of them improve on what the hooks could
report: `session.rotated` is a single event naming both tokens rather than the uncorrelated
created/revoked pair, and `session.revoked_all` carries the count that no hook ever saw.

`session.validation_failed` carries an `actorId` wherever the service knows one, which is every case
except a JWT that never decoded. The hook passes only a token, so a consumer recording the failure
has to look the session up again — a cache read that returns nothing in the common case where the
session is already gone.

API key events reuse the type names the service already logs, so an event and its log line read
identically. `api_key.authenticated` is new: only rejections were visible before, so a machine
login left no record.

`AuthenticationSessionHooks` is deprecated in favour of `AuditSink`, which covers the whole package
rather than sessions alone. Nothing breaks: every hook still fires, and removal is deferred to a
later major. `RecoveryOrchestratorHooks` is not deprecated, because it is behavioural rather than
observational — `onRebindMfaFactor` is where an application mutates the factor and a throw must
abort recovery.

Session events carry the session's `claims` whole, so an application that stamps request detail at
login can recover it on a later revoke that happens on a different request.
