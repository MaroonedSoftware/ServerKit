import { Injectable } from 'injectkit';
import { Duration } from 'luxon';

/**
 * Abstract cache provider. Extend this class and register your concrete implementation
 * (e.g. `IoRedisCacheProvider`) in the DI container.
 *
 * @example
 * ```typescript
 * container.bind(CacheProvider).to(IoRedisCacheProvider);
 * ```
 */
@Injectable()
export abstract class CacheProvider {
  /**
   * Retrieves a cached value by key.
   * @returns The stored string, or `null` if the key does not exist or has expired.
   */
  abstract get(key: string): Promise<string | null>;

  /**
   * Stores a string value under `key` with an explicit TTL.
   * @param key   - Cache key.
   * @param value - String value to store.
   * @param ttl   - Time-to-live after which the entry expires automatically.
   */
  abstract set(key: string, value: string, ttl: Duration): Promise<void>;

  /**
   * Atomically stores `value` under `key` **only if the key does not already exist**
   * (set-if-absent). Use this as a lightweight lock/claim primitive: concurrent callers
   * race, and exactly one wins.
   *
   * @param key     - Cache key.
   * @param value   - String value to store when the key is absent.
   * @param options - Optional settings. `ttl` sets an expiry on the newly created entry.
   * @returns `true` if the key was created (it did not previously exist), `false` if a value
   *   was already present and nothing was written.
   */
  abstract add(key: string, value: string, options?: { ttl?: Duration }): Promise<boolean>;

  /**
   * Overwrites the value of an existing entry, optionally resetting its TTL.
   * @param key   - Cache key of an existing entry.
   * @param value - Replacement value.
   * @param ttl   - New TTL. If omitted, implementations should preserve the original expiry.
   */
  abstract update(key: string, value: string, ttl?: Duration): Promise<void>;

  /**
   * Removes a cached entry.
   * @returns The key that was deleted, or `null` if it did not exist.
   */
  abstract delete(key: string): Promise<string | null>;
}
