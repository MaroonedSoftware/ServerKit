import { Injectable } from 'injectkit';
import { Duration } from 'luxon';

/**
 * Abstract cache provider used by the authentication package for session storage.
 *
 * Extend this class and register your concrete implementation (e.g. Redis, in-memory)
 * in the DI container. The authentication session service resolves it at runtime.
 *
 * @example
 * ```typescript
 * @Injectable()
 * class RedisCacheProvider extends CacheProvider {
 *   async get<T>(key: string) { ... }
 *   async set(key: string, value: unknown, ttl: Duration) { ... }
 *   async update(key: string, value: unknown, ttl?: Duration) { ... }
 *   async delete<T>(key: string) { ... }
 * }
 * ```
 */
@Injectable()
export abstract class CacheProvider {
  /**
   * Retrieve a cached value by key.
   * @returns The stored value cast to `T`, or `null` if the key does not exist or has expired.
   */
  abstract get<T = unknown>(key: string): Promise<T | null>;

  /**
   * Store a value under `key` with an explicit TTL.
   * @param key   - Cache key.
   * @param value - Value to store (implementations should serialise as needed).
   * @param ttl   - Time-to-live after which the entry expires automatically.
   */
  abstract set(key: string, value: unknown, ttl: Duration): Promise<void>;

  /**
   * Update an existing entry, optionally extending its TTL.
   * @param key   - Cache key of an existing entry.
   * @param value - Replacement value.
   * @param ttl   - New TTL; if omitted the implementation should preserve the original TTL.
   */
  abstract update(key: string, value: unknown, ttl?: Duration): Promise<void>;

  /**
   * Remove a cached entry and return the value it held.
   * @returns The removed value cast to `T`, or `null` if the key did not exist.
   */
  abstract delete<T = unknown>(key: string): Promise<T | null>;
}
