---
'@maroonedsoftware/appconfig': minor
---

Add `AppConfig.has(key)` to check whether a value is present (not `undefined` or `null`), and a `get(key, defaultValue)` overload that falls back only when the stored value is missing — not when it is merely falsy.
