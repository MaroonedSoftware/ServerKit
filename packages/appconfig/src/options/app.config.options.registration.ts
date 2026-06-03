import { Identifier, Registry } from 'injectkit';
import { AppConfigOptions, AppConfigOptionsMonitor, AppConfigOptionsSnapshot } from './app.config.options.js';
import { AppConfigOptionsManager } from './app.config.options.manager.js';
import { AppConfigStore } from './app.config.store.js';

/**
 * The DI tokens to register for a configuration section, one per options tier.
 *
 * Each token is the abstract class a section declares by subclassing the
 * corresponding base (e.g. `class SlackOptionsMonitor extends AppConfigOptionsMonitor<SlackConfig> {}`).
 * Pass only the tiers a section actually uses.
 *
 * @template T - The shape of the configuration section.
 */
export interface AppConfigOptionsTokens<T> {
  /** Token for the static boot-snapshot tier ({@link AppConfigOptions}). */
  options?: Identifier<AppConfigOptions<T>>;
  /** Token for the per-request scoped tier ({@link AppConfigOptionsSnapshot}). */
  snapshot?: Identifier<AppConfigOptionsSnapshot<T>>;
  /** Token for the live singleton tier ({@link AppConfigOptionsMonitor}). */
  monitor?: Identifier<AppConfigOptionsMonitor<T>>;
}

/**
 * Wires the requested options tiers for one configuration section into a registry.
 *
 * - `options` is registered as a singleton boot snapshot.
 * - `monitor` is registered as the singleton live monitor owned by the manager.
 * - `snapshot` is registered as a scoped factory, so each request scope resolves
 *   the value current at the start of that request.
 *
 * Uses the standard InjectKit registration API (`register(token).useInstance(...)`
 * / `.useFactory(...).asScoped()`), so consumers inject the tokens the same way
 * they inject any other service.
 *
 * @template TRoot - The root configuration type.
 * @template K - The section key within `TRoot`.
 * @param registry - The registry to register into (before `build()`).
 * @param store - The reloadable store (read by the scoped snapshot factory).
 * @param manager - The manager that owns the live monitor and boot snapshot.
 * @param key - The configuration section key.
 * @param tokens - The per-tier tokens to register; omit a tier to skip it.
 *
 * @example
 * ```typescript
 * registerAppConfigOptions(registry, store, manager, 'slack', {
 *   monitor: SlackOptionsMonitor,
 *   snapshot: SlackOptionsSnapshot,
 * });
 * ```
 */
export function registerAppConfigOptions<TRoot, K extends keyof TRoot & string>(
  registry: Registry,
  store: AppConfigStore<TRoot>,
  manager: AppConfigOptionsManager<TRoot>,
  key: K,
  tokens: AppConfigOptionsTokens<TRoot[K]>,
): void {
  if (tokens.options) {
    registry.register(tokens.options).useInstance(manager.options(key));
  }
  if (tokens.monitor) {
    registry.register(tokens.monitor).useInstance(manager.monitor(key));
  }
  if (tokens.snapshot) {
    registry
      .register(tokens.snapshot)
      .useFactory(() => ({ value: store.current.getAs<TRoot[K]>(key) }))
      .asScoped();
  }
}
