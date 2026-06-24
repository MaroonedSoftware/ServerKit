import { AppConfigSource } from '../app.config.source.js';
import { nestKeys } from '../helpers.js';

/**
 * Options shared by {@link AppConfigSourceFetch} subclasses — the secret managers today
 * ({@link import('./app.config.source.aws.secrets.js').AppConfigSourceAwsSecrets},
 * {@link import('./app.config.source.gcp.secrets.js').AppConfigSourceGcpSecrets}).
 *
 * @property ids - An explicit list of ids to load. When omitted, the source discovers
 *   them (a provider-specific list call, narrowed by a provider-specific filter).
 * @property stripPrefix - Removed from the start of each id before it becomes a config key.
 * @property nameSeparator - When set, derived keys are split on this separator into a nested object.
 * @property ignoreMissing - When `true`, a missing value is skipped instead of failing
 *   the whole load. Defaults to `false`.
 * @property concurrency - Caps how many fetches run at once during `load`. Unbounded by
 *   default (all at once). Set it when loading many values to avoid provider throttling —
 *   throttling triggers retries that make a cold boot *slower*, not faster.
 */
export interface AppConfigSourceFetchOptions {
  ids?: string[];
  stripPrefix?: string;
  nameSeparator?: string;
  ignoreMissing?: boolean;
  concurrency?: number;
}

/**
 * Base class for configuration sources that **fetch each value by key** from a store with no
 * bulk read — the access pattern of secret/parameter managers and remote key-value stores
 * (vs {@link import('./app.config.source.file.js').AppConfigSourceFile}, which reads one
 * document, or the Postgres source, which runs one table query).
 *
 * Owns everything those sources share — the explicit-list-or-discover decision, the
 * concurrent fetch, key derivation (`stripPrefix`), nesting (`nameSeparator`), and the
 * load-snapshot **cache** — and delegates the backend-specific bits to
 * {@link AppConfigSourceFetch.fetch} (fetch one value) and {@link AppConfigSourceFetch.discover}
 * (list ids). Override {@link AppConfigSourceFetch.fetchMany} to fetch in bulk where the
 * backend supports it (e.g. AWS `BatchGetSecretValue`). The fetch-per-key analog of
 * {@link import('./app.config.source.file.js').AppConfigSourceFile}.
 *
 * Implements {@link AppConfigSource} — bulk `load` plus single `get` — so the same instance
 * backs both bulk loading and `${scheme:…}` reference resolution, and a `get` for a value
 * that `load` already fetched is served from the cache rather than re-fetched.
 */
export abstract class AppConfigSourceFetch implements AppConfigSource {
  private cache?: Map<string, unknown>;

  /**
   * @param options - The values to load and how their ids map to config keys.
   */
  constructor(protected readonly options: AppConfigSourceFetchOptions = {}) {}

  /**
   * Loads the configured values and assembles them into a configuration object.
   *
   * Uses the explicit `ids` or, when none were given, {@link AppConfigSourceFetch.discover};
   * fetches them via {@link AppConfigSourceFetch.fetchMany}; keys each under its id
   * (less `stripPrefix`); and nests on `nameSeparator` when set. Values that resolve to
   * `undefined` (tolerated misses) are skipped in the layer. The fetched values are cached
   * (replacing any previous snapshot) so {@link AppConfigSourceFetch.get} can serve them
   * without a second round trip; a reload refreshes the cache.
   *
   * @returns A promise resolving to the assembled config layer.
   */
  async load(): Promise<Record<string, unknown>> {
    const ids = this.options.ids ?? (await this.discover());
    const values = await this.fetchMany(ids);

    const cache = new Map<string, unknown>();
    const flat: Record<string, unknown> = {};
    for (const [id, value] of values) {
      cache.set(id, value);
      if (value !== undefined) {
        flat[this.deriveKey(id)] = value;
      }
    }
    this.cache = cache;

    return this.options.nameSeparator ? nestKeys(flat, this.options.nameSeparator) : flat;
  }

  /**
   * Fetches and parses a single value by id — the {@link AppConfigSource.get} capability
   * behind the `${scheme:…}` resolvers.
   *
   * Serves the value from the last {@link AppConfigSourceFetch.load} snapshot when present
   * (so resolving a reference to a value the source already bulk-loaded adds no round trip),
   * otherwise fetches it directly. Cache misses are **not** cached — only `load` populates the
   * cache — so a resolver-only source (never `load`ed) always fetches fresh and a rotated
   * value is never served stale.
   *
   * @param id - The id of the value to fetch.
   * @returns The JSON-parsed value (raw string when not JSON), or `undefined` when the value
   *   is missing and `ignoreMissing` is set.
   */
  async get(id: string): Promise<unknown> {
    if (this.cache?.has(id)) {
      return this.cache.get(id);
    }
    return this.fetch(id);
  }

  /**
   * No-op watch: a fetch-by-key store exposes no change signal, so reloads stay driven by the
   * application (or by re-resolving rotated secrets through
   * {@link import('../options/app.config.store.js').AppConfigStore.reload}).
   *
   * @returns A disposer that does nothing.
   */
  watch(_: () => void): () => void {
    return () => {};
  }

  /**
   * Fetches a set of values, keyed by id. Defaults to a per-id
   * {@link AppConfigSourceFetch.fetch}, bounded by `concurrency`; override when the backend
   * offers a bulk/batch API (e.g. AWS `BatchGetSecretValue`) to cut round trips at boot.
   *
   * @param ids - The ids to fetch.
   * @returns A map of id → value (value `undefined` for a tolerated miss).
   */
  protected async fetchMany(ids: string[]): Promise<Map<string, unknown>> {
    const entries = await this.mapLimit(ids, async id => [id, await this.fetch(id)] as const);
    return new Map(entries);
  }

  /**
   * Runs `fn` over `items`, bounded by the configured `concurrency` (unbounded when unset).
   * Shared by the default {@link AppConfigSourceFetch.fetchMany} and bulk overrides.
   *
   * @param items - The inputs to map.
   * @param fn - The async mapper.
   * @returns The results, in input order.
   * @internal
   */
  protected async mapLimit<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
    const limit = this.options.concurrency;
    if (!limit || limit >= items.length) {
      return Promise.all(items.map(fn));
    }
    const results = new Array<R>(items.length);
    let index = 0;
    const worker = async (): Promise<void> => {
      while (index < items.length) {
        const i = index++;
        results[i] = await fn(items[i]!);
      }
    };
    await Promise.all(Array.from({ length: limit }, () => worker()));
    return results;
  }

  /**
   * Maps an id to its config key by removing {@link stripPrefix} when present.
   *
   * @param id - The value's id.
   * @returns The config key the value is stored under.
   * @internal
   */
  protected deriveKey(id: string): string {
    return this.options.stripPrefix && id.startsWith(this.options.stripPrefix) ? id.slice(this.options.stripPrefix.length) : id;
  }

  /**
   * Fetches and parses a single value by id (backend-specific).
   *
   * @param id - The id of the value to fetch.
   * @returns The JSON-parsed value, or `undefined` when missing and `ignoreMissing` is set.
   */
  protected abstract fetch(id: string): Promise<unknown>;

  /**
   * Lists the secret ids to load when no explicit `ids` was given.
   *
   * @returns Every secret id matching the source's configured filter.
   * @internal
   */
  protected abstract discover(): Promise<string[]>;
}
