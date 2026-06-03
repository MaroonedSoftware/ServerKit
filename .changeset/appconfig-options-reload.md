---
'@maroonedsoftware/appconfig': minor
---

Add live configuration support: an `AppConfigStore` that rebuilds the config on demand (e.g. when a secret rotates) and swaps it in only on a successful rebuild, plus an `IOptions`-style accessor trio — `AppConfigOptions<T>` (static boot snapshot), `AppConfigOptionsSnapshot<T>` (per-request scoped), and `AppConfigOptionsMonitor<T>` (live singleton with `.current` and `onChange`). `AppConfigOptionsManager` keeps the monitors in sync with the store, and `registerAppConfigOptions` wires the tiers into an InjectKit registry following the existing class-token convention. `onChange` listeners may be async, are skipped for structurally-identical reloads, and have their failures reported via `@maroonedsoftware/logger` (a new workspace dependency) without affecting the swap or other listeners.
