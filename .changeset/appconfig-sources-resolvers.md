---
'@maroonedsoftware/appconfig': major
---

Restructure configuration around **sources** (load a layer) and **resolvers** (substitute `${scheme:…}` reference tokens). Breaking changes:

- "Providers" are renamed to "resolvers": `AppConfigProvider*` → `AppConfigResolver*` (`Env` / `AwsSecrets` / `GcpSecrets` / `Postgres`, plus the `AppConfigResolver` interface and `AppConfigKeyedResolver` base).
- Secret/file/remote loading moves into dedicated sources: `AppConfigSourceFile` (base for `Json` / `Yaml` / `Dotenv`), `AppConfigSourceFetch` (base for `AwsSecrets` / `GcpSecrets`), and `AppConfigSourcePostgres` (file renamed to `app.config.source.postgres.ts`).
- Live configuration is wired through `AppConfigModule` and `AppConfigSection` over a reloadable `AppConfigStore`, replacing the previous options manager/monitor.
- `AppConfigBuilder` now exposes `buildSnapshot()` (one-shot, immutable) and `buildStore()` (hot-reloadable) instead of a single `build()`, and the pipeline passes are exported standalone: `buildConfigObject`, `resolveValues`, `resolveReferences`.
