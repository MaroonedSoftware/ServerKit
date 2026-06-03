import { AppConfig } from '../app.config.js';
import { AppConfigBuilder } from '../app.config.builder.js';

/**
 * A subscriber notified whenever the store swaps in a freshly built config.
 *
 * @template TRoot - The root configuration type.
 */
export type AppConfigStoreListener<TRoot> = (config: AppConfig<TRoot>) => void;

/**
 * Holds the current {@link AppConfig} and can rebuild it on demand, broadcasting
 * the swap to subscribers.
 *
 * `AppConfig` itself is immutable; this store is the single mutable source of
 * truth for "which config is current". A reload re-runs the full
 * {@link AppConfigBuilder} pipeline — re-reading every source and re-resolving
 * every provider (including GCP/AWS Secret Manager references) — so a rotated
 * secret is picked up without restarting the process.
 *
 * The store delivers only the `reload()` primitive and its notification fan-out;
 * the trigger that decides *when* to reload (a timer, a GCP Pub-Sub message, an
 * AWS EventBridge event) lives in the consuming application.
 *
 * @template TRoot - The root configuration type produced by the builder.
 *
 * @example
 * ```typescript
 * const builder = new AppConfigBuilder().addSource(...).addProvider(...);
 * const store = new AppConfigStore(builder, await builder.build<RootConfig>());
 *
 * // later, from a watch trigger:
 * await store.reload().catch(err => logger.error('config reload failed', err));
 * ```
 */
export class AppConfigStore<TRoot = Record<string, unknown>> {
  private config: AppConfig<TRoot>;
  private readonly listeners = new Set<AppConfigStoreListener<TRoot>>();

  /**
   * Creates a store seeded with an already-built config.
   *
   * @param builder - The builder used to rebuild the config on each `reload()`.
   *   Pass the same builder instance that produced `initial`.
   * @param initial - The config to serve until the first successful reload.
   */
  constructor(
    private readonly builder: AppConfigBuilder,
    initial: AppConfig<TRoot>,
  ) {
    this.config = initial;
  }

  /**
   * The config currently in effect.
   */
  get current(): AppConfig<TRoot> {
    return this.config;
  }

  /**
   * Rebuilds the config and, on success, swaps it in and notifies subscribers.
   *
   * The new config is built fully before anything is swapped, so a failed
   * rebuild (e.g. a secret that is momentarily unresolvable) leaves the current
   * config untouched and the error is rethrown for the caller to log. This keeps
   * a running process on its last-good values rather than crashing it — unlike
   * boot, where a build failure is meant to stop startup.
   *
   * @returns A promise that resolves once the swap and notifications complete.
   * @throws Propagates any error thrown while building the new config; the
   *   current config is left in place.
   */
  async reload(): Promise<void> {
    const next = await this.builder.build<TRoot>();
    this.config = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }

  /**
   * Subscribes to config swaps.
   *
   * @param listener - Called with the new config after each successful reload.
   * @returns A function that removes the listener when called.
   */
  subscribe(listener: AppConfigStoreListener<TRoot>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
