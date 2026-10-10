---
'@maroonedsoftware/authentication': patch
---

Fix a race in the support-verification single-use check. The replay guard in `SupportVerificationCodeService.verifyCode` read the consumed marker and wrote it back as two separate cache operations, so two concurrent presentations of the same valid code could both observe the marker absent and both succeed. The check now claims the counter with a single atomic `cache.add` (set-if-absent), matching the TOTP and refresh-token guards elsewhere in the package, so exactly one presentation wins and the other is rejected as a replay.
