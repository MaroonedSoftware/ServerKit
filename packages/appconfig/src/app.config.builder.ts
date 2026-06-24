import { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from './app.config.js';
import { AppConfigResolver } from './app.config.resolver.js';
import { AppConfigSource } from './app.config.source.js';
import { buildConfigObject } from './pipeline.js';
import { AppConfigStore } from './options/app.config.store.js';

/**
 * Builder for constructing AppConfig instances from multiple sources with reference resolution.
 *
 * The builder lets you:
 * - Load configuration from multiple sources (files, environment, secret managers, …)
 * - Merge configurations with later sources overriding earlier ones
 * - Resolve `${…}` references through resolvers (env, GCP/AWS secrets)
 * - Optionally resolve intra-config `${ref:…}` references
 *
 * Call {@link AppConfigBuilder.buildSnapshot} for a one-shot, immutable {@link AppConfig}, or
 * {@link AppConfigBuilder.buildStore} for a hot-reloadable {@link AppConfigStore} that owns
 * the sources, watches them for changes, and re-runs the pipeline on reload.
 *
 * @example
 * ```typescript
 * const config = await new AppConfigBuilder()
 *   .addSource(new AppConfigSourceJson('./config.json'))
 *   .addSource(new AppConfigSourceDotenv())
 *   .addResolver(new AppConfigResolverEnv())
 *   .buildSnapshot();
 * ```
 */
export class AppConfigBuilder {
  private readonly sources: AppConfigSource[] = [];
  private readonly resolvers: AppConfigResolver[] = [];
  private referencesEnabled = false;

  /**
   * Adds a configuration source.
   *
   * Sources are loaded in the order they are added; later sources override earlier ones
   * when merging.
   *
   * @param source - The configuration source to add.
   * @returns The builder instance for method chaining.
   */
  addSource(source: AppConfigSource): this {
    this.sources.push(source);
    return this;
  }

  /**
   * Adds a resolver to transform `${…}` reference tokens in string values.
   *
   * Resolvers are applied to every string value in the merged configuration; the first
   * resolver whose `canResolve` matches a value transforms it.
   *
   * @param resolver - The resolver to add.
   * @returns The builder instance for method chaining.
   */
  addResolver(resolver: AppConfigResolver): this {
    this.resolvers.push(resolver);
    return this;
  }

  /**
   * Enables the intra-config `${ref:some.path}` resolution pass, run after resolvers over
   * the merged, externally-resolved tree.
   *
   * @param enable - Whether to run the reference pass. Defaults to `true`.
   * @returns The builder instance for method chaining.
   */
  resolveReferences(enable = true): this {
    this.referencesEnabled = enable;
    return this;
  }

  /**
   * Builds a one-shot, immutable {@link AppConfig}: loads every source once, merges, and
   * resolves. Use this when you do not need hot reload (e.g. a CLI).
   *
   * @template T - The configuration object type. Defaults to `Record<string, unknown>`.
   * @returns A promise resolving to the built {@link AppConfig}.
   */
  async buildSnapshot<T = Record<string, unknown>>(): Promise<AppConfig<T>> {
    const snapshots = await Promise.all(this.sources.map(source => source.load()));
    const merged = await buildConfigObject(snapshots, this.resolvers, this.referencesEnabled);
    return new AppConfig<T>(merged as T);
  }

  /**
   * Builds a hot-reloadable {@link AppConfigStore}: loads every source once for the initial
   * config, then hands the sources/resolvers to the store, which re-runs the pipeline on
   * each reload and subscribes to any watchable sources.
   *
   * @template T - The root configuration object type.
   * @param logger - Optional logger used to report failures from watch-triggered reloads.
   * @returns A promise resolving to the {@link AppConfigStore}.
   */
  async buildStore<T = Record<string, unknown>>(logger?: Logger): Promise<AppConfigStore<T>> {
    const loaded = await Promise.all(this.sources.map(source => source.load()));
    const snapshots = new Map<AppConfigSource, Record<string, unknown>>(this.sources.map((source, i) => [source, loaded[i]!]));
    const merged = await buildConfigObject(loaded, this.resolvers, this.referencesEnabled);
    return new AppConfigStore<T>({
      sources: this.sources,
      resolvers: this.resolvers,
      resolveRefs: this.referencesEnabled,
      snapshots,
      initial: new AppConfig<T>(merged as T),
      logger,
    });
  }
}
