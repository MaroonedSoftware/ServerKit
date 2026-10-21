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

  /**
   * Atomically adds `member` to the set stored at `key`, creating the set when it does not
   * exist. Concurrent callers adding different members to one set never lose each other's
   * writes, which a `get` / modify / `set` of a serialised list cannot promise.
   *
   * @param key     - Cache key of the set.
   * @param member  - Member to add. Adding a member already present is a no-op.
   * @param options - Optional settings. `ttl` extends the set's expiry to at least that long
   *   from now; it never shortens an expiry that is already further out.
   * @returns `true` if the member was added, `false` if it was already present.
   */
  abstract setAdd(key: string, member: string, options?: { ttl?: Duration }): Promise<boolean>;

  /**
   * Atomically removes `member` from the set stored at `key`. A set left empty is removed.
   * @returns `true` if the member was removed, `false` if it was not present.
   */
  abstract setRemove(key: string, member: string): Promise<boolean>;

  /**
   * Retrieves every member of the set stored at `key`, in no particular order.
   * @returns The members, or an empty array if the set does not exist or has expired.
   */
  abstract setMembers(key: string): Promise<string[]>;

  /**
   * Atomically reads and removes an entry (get-and-delete). Use this to consume single-use
   * entries such as one-time tokens or pending authorizations: concurrent callers race, and at
   * most one of them receives the value. A `get` followed by a `delete` is not a substitute,
   * since two callers can both pass the `get` before either deletes.
   *
   * @returns The stored string, or `null` if the key does not exist, has expired, or was
   *   already taken by another caller.
   */
  abstract take(key: string): Promise<string | null>;
}
