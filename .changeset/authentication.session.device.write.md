---
'@maroonedsoftware/authentication': minor
---

Accept device metadata on the session write paths. `createSession`, `createOrUpdateSession`, and
`rotateSession` each take an optional trailing `device`, normalised on the way in. Every parameter is
trailing and optional, so no existing call changes.

A rotation carries the original device forward unless the caller supplies a new one. A step-up
happens on a live request, but the session's origin is where it began, which is the same reason
claims carry forward across a rotation rather than being rebuilt. An application that genuinely wants
to re-stamp passes the current request's context.

An empty block normalises to nothing, and nothing means "not given", so a rotation cannot blank an
existing device by passing an adapter's empty-string default.

`createOrUpdateSession` only passes it on the create arm: updating a live session must not rewrite
where that session began.

`ApiKeyService.authenticate` leaves it unset deliberately. A machine credential has no device, and
inventing one would put a misleading row in a user's session list.
