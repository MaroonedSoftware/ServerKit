---
'@maroonedsoftware/authentication': patch
---

Fix `AuthenticationSessionService.lookupSessionFromJwt` to compare the session subject against the JWT `sub` claim instead of a non-existent `subject` field. The previous check always treated the JWT subject as `undefined`, so a token whose session existed in cache would pass validation regardless of which subject it was actually issued for.
