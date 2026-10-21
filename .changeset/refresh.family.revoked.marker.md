---
'@maroonedsoftware/authentication': patch
---

A rotation that races a theft revocation can no longer outlive it. Revoking a refresh-token family now first sets `auth_refresh_family_revoked_{familyId}`. `rotateSession` checks for that marker after it has linked and written the new session, and if the marker is set, it deletes the new session and fails with a 401. Because the revocation writes the marker before walking the chain, and the rotation writes before checking, either the walk reaches the new session or the rotation sees the marker.
