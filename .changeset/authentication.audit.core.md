---
'@maroonedsoftware/authentication': major
---

**Breaking:** `AuthenticationSessionHooks` is removed, along with the fifth `hooks` argument to
`AuthenticationSessionServiceOptions`. Bind an `AuditSink` instead.

The hooks existed to observe the session lifecycle, and the audit sink does that better: it covers
the whole package rather than sessions alone, carries a common envelope on every event, and
attributes an `actorId` on validation failures where the hook passed only a token. Migration is
mechanical:

| Hook                     | Event                                                           |
| ------------------------ | --------------------------------------------------------------- |
| `onSessionCreated`       | `session.created`                                               |
| `onSessionRefreshed`     | `session.refreshed` (`data.previousJti`)                        |
| `onSessionRevoked`       | `session.revoked` (`data.reason`)                               |
| `onValidationFailed`     | `session.validation_failed` (`data.reason`), now with `actorId` |
| `onRefreshReuseDetected` | `session.refresh_reuse_detected`                                |

Two things improve in the move. A rotation is one `session.rotated` event naming both tokens rather
than an uncorrelated `onSessionCreated` and `onSessionRevoked` pair, and `revokeAllForSubject` emits
a `session.revoked_all` carrying the count that no hook ever saw.

Session events also carry the session's `claims` whole, so an application that stamps request detail
at login can still recover it on a revoke that happens on a different request.

`AuthenticationSessionService` also drops its `Logger` constructor parameter, which `runHook` was
the only consumer of. Applications resolving the service through dependency injection are
unaffected. Anything constructing it by hand should remove the fourth argument; because
`AuditRecorder` moves into that position, passing the old argument list is a type error rather than
a silent mis-binding.

`RecoveryOrchestratorHooks` is **not** affected. It is behavioural rather than observational —
`onRebindMfaFactor` is where an application mutates the factor, and a throw there must abort the
recovery.

Adds the seam this replaces it with: `AuditSink`, `AuditRecorder`, and the event contract. Services
take the recorder as a defaulted trailing constructor parameter, so an unbound sink is a working
no-op. A sink failure is swallowed and logged as `audit.sink_failed` by default, so an audit store
outage cannot become a login outage — alert on that event or the outage is invisible.
`AuditOptions.strict` inverts it for deployments where an action that could not be recorded must not
proceed.
