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
