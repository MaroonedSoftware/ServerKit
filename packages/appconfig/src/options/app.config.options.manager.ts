import { Logger } from '@maroonedsoftware/logger';
import { AppConfigOptions, AppConfigOptionsMonitor } from './app.config.options.js';
import { AppConfigOptionsMonitorImpl } from './app.config.options.monitor.js';
import { AppConfigStore } from './app.config.store.js';

/**
 * Owns the live options monitors for a config and keeps them in sync with an
 * {@link AppConfigStore}.
 *
 * On construction it subscribes to the store; whenever the store reloads, every
 * monitor it has handed out is updated with its section's latest value (sliced
 * via `AppConfig.getAs`). Monitors are created lazily and cached per section, so
 * repeated calls to {@link AppConfigOptionsManager.monitor} for the same key
 * return the same instance.
 *
 * @template TRoot - The root configuration type held by the store.
 *
 * @example
 * ```typescript
 * const store = new AppConfigStore(builder, await builder.build<RootConfig>());
 * const manager = new AppConfigOptionsManager(store, logger);
 * const slack = manager.monitor('slack');
 * slack.current; // latest SlackConfig, updated on every store.reload()
 * ```
 */
export class AppConfigOptionsManager<TRoot = Record<string, unknown>> {
  private readonly monitors = new Map<keyof TRoot, AppConfigOptionsMonitorImpl<unknown>>();

  /**
   * @param store - The reloadable config store to track.
   * @param logger - Passed to each monitor for listener-error reporting.
   */
  constructor(
    private readonly store: AppConfigStore<TRoot>,
    private readonly logger: Logger,
  ) {
    this.store.subscribe(config => {
      for (const [key, monitor] of this.monitors) {
        monitor.update(config.getAs(key));
      }
    });
  }

  /**
   * Returns the live monitor for a section, creating it on first use.
   *
   * @param key - The configuration section key.
   * @returns A monitor whose `current` tracks the latest value for `key`.
   */
  monitor<K extends keyof TRoot>(key: K): AppConfigOptionsMonitor<TRoot[K]> {
    let monitor = this.monitors.get(key);
    if (!monitor) {
      monitor = new AppConfigOptionsMonitorImpl<unknown>(this.store.current.getAs(key), this.logger);
      this.monitors.set(key, monitor);
    }
    return monitor as unknown as AppConfigOptionsMonitor<TRoot[K]>;
  }

  /**
   * Returns a boot-snapshot accessor for a section.
   *
   * The value is read from the config current at call time and never updated —
   * the static (`IOptions`) tier. Call this during registration so the captured
   * value is the one in effect at container-build time.
   *
   * @param key - The configuration section key.
   * @returns An {@link AppConfigOptions} holding the section's snapshot value.
   */
  options<K extends keyof TRoot>(key: K): AppConfigOptions<TRoot[K]> {
    return { value: this.store.current.getAs<TRoot[K]>(key) };
  }
}
