---
'@maroonedsoftware/authentication': minor
---

refactor: update AuthenticationContext to use 'subject' instead of 'actorId' and 'actorType'

Replaced 'actorId' and 'actorType' with 'subject' in the AuthenticationContext interface to better reflect the authenticated entity. Updated the invalidAuthenticationContext accordingly. Adjusted tests to verify the new 'subject' property.
