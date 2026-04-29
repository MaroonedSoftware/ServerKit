---
'@maroonedsoftware/authentication': major
---

Rename `PasswordFactorService.checkStrength` to `checkPasswordStrength` for parallelism with `ensurePasswordStrength`. Callers on 1.1.0 must rename their call sites.
