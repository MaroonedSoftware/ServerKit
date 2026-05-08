---
'@maroonedsoftware/authentication': minor
---

Reshape `AllowlistProvider` to return a result instead of throwing. Methods are renamed `ensureEmailIsAllowed` → `checkEmailIsAllowed` and `ensurePhoneIsAllowed` → `checkPhoneIsAllowed`, and now return `Promise<AllowListResult>` (`{ allowed: true } | { allowed: false, reason?: 'invalid_format' | 'deny_list' | string }`). The bundled `EmailFactorService` and `PhoneFactorService` translate a failed check into HTTP 400 with `{ value: reason }`, so the externally observable behaviour for default consumers is unchanged. Subclasses can now report rejections without committing to an HTTP-shaped error. The `AllowListResult` type is exported.
