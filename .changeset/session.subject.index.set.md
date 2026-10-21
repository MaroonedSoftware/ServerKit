---
'@maroonedsoftware/authentication': patch
---

Fix lost updates in the per-subject session index. It was a JSON array of session tokens that every `createSession`, `rotateSession`, `deleteSession` and `revokeAllForSubject` read, modified and rewrote, so two overlapping writes for one subject could drop a session from it. `getSessionsForSubject` then omitted that session and `revokeAllForSubject` (sign out everywhere, password reset, account recovery) left it alive.

The index is now a cache set at `auth_subject_sessions_{subject}`, changed only by the atomic `CacheProvider.setAdd` and `setRemove`. Its expiry only ever grows, so it no longer shrinks to fit the most recently created session. Entries whose session has gone are pruned on read. The old `auth_session_subject_{subject}` list is still read, never written, until it expires, so sessions created before the upgrade stay visible to `revokeAllForSubject`.

Requires a `CacheProvider` that implements the new set operations from `@maroonedsoftware/cache`.
