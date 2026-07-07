import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '../app.config.js';
import { AppConfigResolver } from '../app.config.resolver.js';
import { AppConfigSource } from '../app.config.source.js';
import { buildConfigObject } from '../pipeline.js';

/**
 * A subscriber notified whenever the store swaps in a freshly built config.
 *
 * @template TRoot - The root configuration type.
 */
export type AppConfigStoreListener<TRoot> = (config: AppConfig<TRoot>) => void;

/**
 * Constructor parameters for {@link AppConfigStore}. Produced by
 * {@link import('../app.config.builder.js').AppConfigBuilder.buildStore}; not assembled by
 * hand.
 *
 * @template TRoot - The root configuration type.
 */
export interface AppConfigStoreParams<TRoot> {
  /** The sources, in priority order, re-loaded on reload and watched for changes. */
  sources: AppConfigSource[];
  /** The resolvers applied to the merged tree. */
  resolvers: AppConfigResolver[];
  /** Whether to run the `${ref:…}` reference pass. */
  resolveRefs: boolean;
  /** The per-source snapshots captured for the initial config (source order preserved). */
  snapshots: Map<AppConfigSource, Record<string, unknown>>;
  /** The config built from `snapshots`, served until the first reload. */
  initial: AppConfig<TRoot>;
  /** Optional logger for reporting failures from watch-triggered reloads. */
  logger?: Logger;
}

/**
 * Holds the current {@link AppConfig}, owns the runtime config pipeline, and rebuilds on
 * demand — broadcasting each swap to subscribers.
 *
 * `AppConfig` itself is immutable; this store is the single mutable source of truth for
 * "which config is current". It keeps a per-source snapshot and re-runs the merge +
 * resolution pipeline ({@link buildConfigObject}) on reload, so:
 *
 * - {@link AppConfigStore.reload} re-loads **every** source — the path for picking up a
 *   rotated secret (no source changed, but `${aws:…}`/`${gcp:…}` re-resolve). Drive it from
 *   the app (a timer, a Pub/Sub or EventBridge message).
 * - A source that signals a change through its {@link AppConfigSource.watch} triggers a
 *   reload of **just that source**, then a rebuild. Wired automatically. A source that never
 *   fires (a no-op `watch`) simply never triggers this path.
 *
 * A failed rebuild leaves the current config and snapshots untouched and rethrows, so a
 * running process stays on its last-good values. Call {@link AppConfigStore.dispose} to
 * tear down source watchers.
 *
 * @template TRoot - The root configuration type produced by the pipeline.
 */
export class AppConfigStore<TRoot = Record<string, unknown>> {
  private config: AppConfig<TRoot>;
  private snapshots: Map<AppConfigSource, Record<string, unknown>>;
  private readonly sources: AppConfigSource[];
  private readonly resolvers: AppConfigResolver[];
  private readonly resolveRefs: boolean;
  private readonly logger?: Logger;
  private readonly listeners = new Set<AppConfigStoreListener<TRoot>>();
  private readonly watchDisposers: (() => void)[] = [];

  /**
   * Creates a store. Prefer {@link import('../app.config.builder.js').AppConfigBuilder.buildStore}
   * over calling this directly.
   *
   * @param params - The sources, resolvers, snapshots, and seed config — see {@link AppConfigStoreParams}.
   */
  constructor(params: AppConfigStoreParams<TRoot>) {
    this.sources = params.sources;
    this.resolvers = params.resolvers;
    this.resolveRefs = params.resolveRefs;
    this.snapshots = params.snapshots;
    this.config = params.initial;
    this.logger = params.logger;

    for (const source of this.sources) {
      this.watchDisposers.push(
        source.watch(() => {
          void this.reloadSource(source).catch(err => this.logger?.error('AppConfigStore: watch-triggered reload failed', err));
        }),
      );
    }
  }

  /**
   * The config currently in effect.
   */
  get current(): AppConfig<TRoot> {
    return this.config;
  }

  /**
   * Returns a single, stable {@link AppConfig} whose every read delegates to
   * {@link current} at call time — so it always reflects the latest reload without callers
   * re-resolving anything. The whole-config analog of a typed
   * {@link import('./app.config.section.js').AppConfigSection}.
   *
   * @returns A live {@link AppConfig} view backed by this store.
   */
  toLiveConfig(): AppConfig<TRoot> {
    return new AppConfig<TRoot>(() => this.current.toObject());
  }

  /**
   * Rebuilds the config from **all** sources (re-loading each) and, on success, swaps it in
   * and notifies subscribers. The path for picking up rotated secrets.
   *
   * The new config is built fully before anything is swapped, so a failed rebuild leaves the
   * current config and snapshots untouched and the error is rethrown for the caller to log.
   *
   * @returns A promise that resolves once the swap and notifications complete.
   * @throws Propagates any error thrown while building the new config.
   */
  async reload(): Promise<void> {
    const loaded = await Promise.all(this.sources.map(source => source.load()));
    const candidate = new Map<AppConfigSource, Record<string, unknown>>(this.sources.map((source, i) => [source, loaded[i]!]));
    await this.rebuild(candidate);
  }

  /**
   * Re-loads a single source and rebuilds. Invoked by a watchable source's change signal.
   *
   * @param source - The source whose snapshot to refresh.
   * @returns A promise that resolves once the swap and notifications complete.
   * @throws Propagates any error thrown while building the new config.
   */
  private async reloadSource(source: AppConfigSource): Promise<void> {
    const fresh = await source.load();
    const candidate = new Map(this.snapshots);
    candidate.set(source, fresh);
    await this.rebuild(candidate);
  }

  /**
   * Runs the pipeline over candidate snapshots and, on success, commits both the snapshots
   * and the new config, then notifies subscribers.
   *
   * @param candidate - The snapshots to build from (source order preserved).
   * @internal
   */
  private async rebuild(candidate: Map<AppConfigSource, Record<string, unknown>>): Promise<void> {
    const merged = await buildConfigObject(Array.from(candidate.values()), this.resolvers, this.resolveRefs);
    const next = new AppConfig<TRoot>(merged as TRoot);
    this.snapshots = candidate;
    this.config = next;
    // The swap is already committed and `next` is live. Notification is best-effort: one
    // listener throwing must not stop the others from being notified, nor make `reload()`
    // reject over a config that is already in effect. Isolate each call and log failures.
    for (const listener of this.listeners) {
      try {
        listener(next);
      } catch (error) {
        this.logger?.error('AppConfigStore: config-change listener threw', error);
      }
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

  /**
   * Tears down every source watcher and clears subscribers. Call when shutting down.
   */
  dispose(): void {
    for (const dispose of this.watchDisposers) {
      dispose();
    }
    this.watchDisposers.length = 0;
    this.listeners.clear();
  }
}
