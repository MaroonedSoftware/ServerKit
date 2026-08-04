---
'@maroonedsoftware/appconfig': minor
---

Remove the coercing `AppConfig` accessors: `getString`, `getNumber`, `getBoolean`, and `getObject`.

All four coerced unconditionally, which produced wrong answers for config that arrives as strings: `getBoolean` mapped `'false'` to `true`, `getString` on a missing key returned the literal `'undefined'`, and `getNumber` on a missing key returned `NaN`. `getObject` returned bare `object`, which was unusable without a further cast.

Use the overloaded `get(key)` / `get(key, defaultValue)` for reads, and `getAs<U>(key)` when you need to cast to a specific type. Callers that relied on the old coercion should convert explicitly at the call site, or validate the raw value.
