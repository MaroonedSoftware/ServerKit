---
'@maroonedsoftware/scim': patch
---

Carry the real reason into the SCIM error envelope. `ScimError.toScimBody()` set `detail` from the
error's message, which is the HTTP status text, while every informative message in the package was
attached with `.withDetails({ message })` and never serialised. Okta and Entra saw
`"detail": "Conflict"` or `"Bad Request"` for every failure, with no indication of which attribute
collided or was missing.

`detail` now prefers a string `message` from `details`, falling back to the status text as before.
