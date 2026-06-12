---
'@maroonedsoftware/johnny5': minor
---

Add a `@maroonedsoftware/johnny5/bin` subpath exporting `runTypescriptBin` / `registerTypescriptLoader` — a TypeScript bin shim that anchors the `@swc-node/register` ESM loader to the bin file (cwd-independent), points `SWC_NODE_PROJECT` at the package tsconfig, and narrowly suppresses Node 26's DEP0205 deprecation warning around `module.register()`.

Fix `postgresReachable()` and `redisReachable()` so they work without an AppConfig passed to `createCliApp`. `AppConfig` coerces missing keys to the string `'undefined'` / `NaN` instead of throwing, so the documented `process.env` fallback never fired — postgres connected to a bogus host instead of using `process.env.DATABASE_URL`, and redis attempted `undefined:NaN` instead of defaulting to `localhost:6379`. Both checks now read raw config values at check run time, accept them only when genuinely usable, and fall back to env vars (then defaults for redis).

Harden `buildContext`'s env-file loading: a `.env` that exists but can't be read (EPERM/EACCES from permissions or sandboxes) no longer crashes the CLI before any command runs — it's skipped with a logged warning.
