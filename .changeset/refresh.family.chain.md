---
'@maroonedsoftware/authentication': patch
---

Track refresh-token families as a chain of successor links instead of a shared list. `rotateSession` now records the session it created under `auth_session_successor_{sessionToken}`, and theft revocation follows those links from the replayed token's session.

The old family record (`auth_refresh_family_{familyId}`) was read, modified and rewritten on every token issue. So concurrent refreshes and rotations could drop a live session from it, and that session then survived a theft revocation. Its `jtis` list also grew on every issue and was never read. Nothing in the chain is rewritten.

The successor link is claimed set-if-absent, so of two concurrent rotations of one session only one succeeds and the other gets a 401. A rotation that fails before it takes effect releases its claim and puts the old session back, unless the family was revoked meanwhile. So a transient error doesn't sign the user out, and the session can still be rotated afterwards. Family records written by earlier versions are still read until they expire. Theft revocation revokes the sessions they list and follows the chain from each one, so rotations made after the upgrade are covered too.
