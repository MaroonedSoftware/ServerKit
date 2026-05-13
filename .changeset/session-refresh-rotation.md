---
'@maroonedsoftware/authentication': minor
---

Add session-level refresh tokens with rotation + theft detection, a session
rotation primitive for privilege changes, and a lifecycle-hooks API on
`AuthenticationSessionService`. No consumers exist yet, so the additive
contract change on `issueTokenForSession()` (which now also returns a
`refreshToken`) is shipped as a minor.

- `AuthenticationSessionService` now mints a `familyId` per session at
  `createSession`. `issueTokenForSession` returns `{ accessToken, refreshToken }`
  where the refresh token is a single-use JWT carrying `kind: 'refresh'`,
  `jti`, `familyId`, and `sessionToken` claims. The `jti` is registered in the
  family blob (`auth_refresh_family_{familyId}`) so it can be rotated/revoked.
- New `refreshSession(refreshToken)` method rotates the `jti`, marks the
  previous `jti` consumed (`auth_refresh_consumed_{jti}` sentinel with TTL =
  `max(remaining-token-lifetime, 60s)`), and returns a fresh token pair.
  Presenting an already-consumed `jti` is treated as theft: every session in
  the family is revoked, the family entry is deleted, and
  `onRefreshReuseDetected` fires.
- New `rotateSession(sessionToken, claimOverrides?)` method mints a new
  `sessionToken`, carries the `familyId` forward, merges `claimOverrides` into
  the session claims, deletes the old session, and returns a fresh
  access/refresh pair. Use this for MFA step-up or other privilege changes
  instead of `updateSession`, which still mutates in place.
- `AuthenticationSessionServiceOptions` gains two new constructor parameters:
  `refreshExpiresIn` (defaults to 30 days, used for refresh-token JWT lifetime
  and family-blob TTL — TTL is refreshed on every rotation) and `hooks`
  (`AuthenticationSessionHooks`) supporting `onSessionCreated`,
  `onSessionRefreshed`, `onSessionRevoked` (with discriminated
  `reason: 'logout' | 'rotate' | 'theft' | 'expiry'`), `onValidationFailed`,
  and `onRefreshReuseDetected`. Hooks fire after the cache write/delete commits,
  run sequentially, are awaited, and have errors logged but never propagated.
- `AuthenticationSessionService` constructor gains a `Logger` parameter so hook
  failures can be reported. This is wired through DI; consumers that register
  the service in their container picked up automatically.
- The OAuth2 factor's upstream-provider refresh-token path is unchanged and
  independent of this new session-level mechanism.
