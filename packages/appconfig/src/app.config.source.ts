export interface AppConfigSource {
  /**
   * Loads the whole configuration layer.
   *
   * @returns A promise that resolves to the configuration object.
   */
  load(): Promise<Record<string, unknown>>;

  /**
   * Fetches a single value by key — a flat id (secret managers, Postgres) or a dotted path
   * into the document (file sources).
   *
   * @param key - The id or path addressing the value.
   * @returns The resolved value (JSON-parsed where applicable), or `undefined` when absent.
   *   Sources backed by a remote store may instead throw for a hard-missing value; resolvers
   *   leave a reference untouched when `get` returns `undefined`.
   */
  get(key: string): Promise<unknown>;

  /**
   * Begins watching the backing store for changes.
   *
   * @param onChange - Invoked (with no arguments) whenever the backing store changes; the
   *   store responds by re-loading this source and rebuilding.
   * @returns A disposer that stops watching and releases any underlying resources.
   */
  watch(onChange: () => void): () => void;
}
