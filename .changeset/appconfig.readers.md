---
'@maroonedsoftware/appconfig': minor
---

Add `optionalConfigString`, `requireConfigString`, `configNumber` and `configBoolean`, the readers each app was carrying its own copy of. `AppConfigResolverEnv` no longer treats `$&` or `$$` in a value as a replacement pattern, and keeps a number as text when parsing would change it, so a password of `1.50` stays `1.50` and a long digit string keeps its precision.
