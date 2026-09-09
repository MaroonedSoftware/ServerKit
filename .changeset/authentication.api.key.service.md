---
'@maroonedsoftware/authentication': minor
---

Add `ApiKeyService`: issue, validate, rotate, and revoke machine credentials, plus the
`'auth.api.key.allowed'` policy for gating the surface per actor.

`validate` returns a discriminated result rather than throwing, because the `AuthenticationHandler`
contract needs "not a valid credential" to be a value — a handler that throws stops the chain, so a
bad API key would keep a JWT behind it from ever being tried. The checksum test runs before any
I/O, so a JWT reaching this service costs no database round trip.

`authenticate` mints an ad-hoc, unpersisted session with a random `sessionToken` and a single
`{ method: 'apikey', kind: 'possession' }` factor. One factor fails the default MFA gate, which is
intentional: a key cannot reach an MFA-gated route by accident.

There is no validation cache, so `revoke` takes effect on the next request rather than at the end
of a TTL. `lastUsedAt` writes are throttled through `cache.add` so a busy key does not turn every
request into a database write, and a cache outage degrades to a skipped timestamp rather than a
failed request.

Note that nothing revokes a key when its owner is deleted: call `revokeAllForOwner` from your own
block and delete flows.
