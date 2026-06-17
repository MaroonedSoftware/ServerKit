---
'@maroonedsoftware/appconfig': patch
---

Fix `AppConfig.get(key, defaultValue)` returning `{}` instead of the default value's type on loosely-typed configs (e.g. `Record<string, unknown>`). The default value's type is now preserved, so `config.get('KEY', 'fallback')` is typed as `string`.
