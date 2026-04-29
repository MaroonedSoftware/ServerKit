---
'@maroonedsoftware/authentication': minor
---

Add `PasswordFactorService.clearRateLimit(actorId)` to reset the verify-password rate-limiter counter for an actor — useful after an out-of-band recovery (magic-link sign-in, admin unlock) so the next password attempt isn't blocked by accumulated 429s.
