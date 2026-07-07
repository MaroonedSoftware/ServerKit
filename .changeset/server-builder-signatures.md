---
'@maroonedsoftware/koa': minor
---

**Breaking (koa):** `ServerKitServerBuilder` lifecycle signatures changed.

- `setup()` now resolves to the built DI `Container` instead of the builder. Keep a reference to the builder for chaining rather than chaining off `setup()`:

  ```diff
  - const builder = await new ServerKitServerBuilder().setup(config, logger, modules);
  + const builder = new ServerKitServerBuilder();
  + await builder.setup(config, logger, modules); // returns the built container
  ```

- `setupRoutes()` now takes `Router[]` and mounts each router's `routes()` and `allowedMethods()`, instead of taking pre-built middleware:

  ```diff
  - builder.setupRoutes([router.routes(), router.allowedMethods()]);
  + builder.setupRoutes([router]);
  ```
