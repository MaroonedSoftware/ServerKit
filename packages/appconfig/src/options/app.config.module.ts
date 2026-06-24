import { Identifier, Registry } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '../app.config.js';
import { AppConfigBuilder } from '../app.config.builder.js';
import { AppConfigSection, AppConfigSectionImpl } from './app.config.section.js';
import { AppConfigStore } from './app.config.store.js';

/**
 * One-call wiring for hot-reloadable configuration — the ServerKit analog of a
 * sequence of C# `services.Configure<T>(configuration.GetSection("..."))` calls.
 *
 * The module bundles the moving parts (a reloadable {@link AppConfigStore} and the
 * per-section {@link AppConfigSection} tokens, each backed directly by the store) so an
 * application wires configuration in a single fluent pass instead of assembling them by hand:
 *
 * ```ts
 * @Injectable() abstract class SlackOptions extends AppConfigSection<SlackConfig> {}
 * @Injectable() abstract class DbOptions extends AppConfigSection<DbConfig> {}
 *
 * const config = await AppConfigModule.create<RootConfig>(builder, logger);
 * config.configure('slack', SlackOptions).configure('database', DbOptions);
 * config.register(registry);
 *
 * // inject SlackOptions anywhere: .value (scope snapshot), .current (live), .onChange(...)
 * ```
 *
 * Reloadability is always on: {@link AppConfigModule.register} also registers the
 * `AppConfig` token as a live view (see {@link AppConfigStore.toLiveConfig}), so
 * even ad-hoc key access observes a reload. The module only delivers the
 * {@link AppConfigModule.reload} primitive; the trigger that decides *when* to
 * reload (a timer, a GCP Pub/Sub message, an AWS EventBridge event) lives in the
 * consuming application.
 *
 * @template TRoot - The root configuration type produced by the builder.
 */
export class AppConfigModule<TRoot = Record<string, unknown>> {
  /**
   * One closure per configured section. Each captures the concrete section key
   * `K` so the registration is fully typed (the key/token link erases once a
   * heterogeneous list is involved).
   */
  private readonly registrars: ((registry: Registry) => void)[] = [];

  /**
   * @param store - The reloadable store seeded with the boot config; backs every section.
   * @param logger - Used by sections to report `onChange` listener failures.
   */
  private constructor(
    readonly store: AppConfigStore<TRoot>,
    private readonly logger: Logger,
  ) {}

  /**
   * Builds the boot config and assembles a module around it.
   *
   * The store retains the sources and resolvers so each {@link AppConfigModule.reload}
   * re-runs the full pipeline — re-reading every source and re-resolving every resolver
   * (including GCP/AWS Secret Manager references).
   *
   * @template TRoot - The root configuration type.
   * @param builder - The configured builder; built once now and on every reload.
   * @param logger - Used by sections to report `onChange` listener failures.
   * @returns A module ready for {@link AppConfigModule.configure} / {@link AppConfigModule.register}.
   */
  static async create<TRoot = Record<string, unknown>>(builder: AppConfigBuilder, logger: Logger): Promise<AppConfigModule<TRoot>> {
    const store = await builder.buildStore<TRoot>(logger);
    return new AppConfigModule<TRoot>(store, logger);
  }

  /**
   * Binds a section key to its injectable token.
   *
   * @template K - The section key within `TRoot`.
   * @param key - The configuration section key.
   * @param token - The section token (a subclass of {@link AppConfigSection}).
   * @returns This module, for chaining.
   */
  configure<K extends keyof TRoot & string>(key: K, token: Identifier<AppConfigSection<TRoot[K]>>): this {
    this.registrars.push(registry => {
      registry
        .register(token)
        .useFactory(() => new AppConfigSectionImpl<TRoot, K>(this.store.current.getAs<TRoot[K]>(key), this.store, key, this.logger))
        .asScoped();
    });
    return this;
  }

  /**
   * Registers the live `AppConfig` token plus every configured section token.
   *
   * - `AppConfig` resolves to a live view over the store (see
   *   {@link AppConfigStore.toLiveConfig}), so it always reflects the latest reload.
   * - Each section token is registered as a *scoped* service: its `value` is the
   *   snapshot for the resolving scope (per-request in a request scope), while
   *   `current` / `onChange` read through the singleton store and stay live for
   *   any consumer.
   *
   * @param registry - The registry to register into (before `build()`).
   */
  register(registry: Registry): void {
    registry.register(AppConfig).useInstance(this.store.toLiveConfig() as AppConfig);
    for (const registrar of this.registrars) {
      registrar(registry);
    }
  }

  /**
   * Rebuilds the config and swaps it in on success, which notifies every section's
   * `onChange` subscribers. Delegates to {@link AppConfigStore.reload}; a failed rebuild
   * leaves the current config in place and rethrows.
   *
   * @returns A promise that resolves once the swap and notifications complete.
   */
  reload(): Promise<void> {
    return this.store.reload();
  }
}
