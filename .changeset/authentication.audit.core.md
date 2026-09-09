---
'@maroonedsoftware/authentication': minor
---

Add the audit seam: `AuditSink`, `AuditRecorder`, and the event contract. No events are emitted yet;
later changes fill in the domains.

An application implements `AuditSink` and registers it, and every service in the package records
through `AuditRecorder`, which stamps `occurredAt` and applies the failure policy in one place.
Services take the recorder as a defaulted trailing constructor parameter, so a consumer who has not
opted in keeps their existing constructor calls and the default recorder drops every event.

A sink failure is swallowed and logged as `audit.sink_failed` by default, so an audit store outage
cannot become a login outage. Alert on that event or the outage is invisible. `AuditOptions.strict`
inverts it for deployments where an action that could not be recorded must not proceed.

`CompositeAuditSink` offers an event to every member even when one throws, then rethrows what
failed, so a broken SIEM does not cost you the database row while the recorder's failure policy
stays meaningful. `LoggingAuditSink` writes through `Logger` using the same dotted-event convention
the package already logs with.

The package never fills `AuditEventContext`: it sits at L2 alongside the HTTP adapters and cannot
reach a request, so `correlationId` and `ipAddress` are filled by the application's own
request-scoped sink.
