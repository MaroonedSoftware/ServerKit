---
'@maroonedsoftware/koa': patch
---

Constrain `ServerKitModule<ConfigT>` so `ConfigT` must extend `AppConfig`, ensuring the config passed to `setup` is always usable as an `AppConfig`.
