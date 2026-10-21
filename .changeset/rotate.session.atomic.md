---
'@maroonedsoftware/authentication': patch
---

`AuthenticationSessionService.rotateSession` now consumes the old session atomically with `CacheProvider.take` before it writes the replacement. Two concurrent rotations of one session (for example a double-submitted MFA step-up) previously both succeeded and left two live elevated sessions, only one of them tracked in the refresh-token family. Now the second rotation gets a 401.
