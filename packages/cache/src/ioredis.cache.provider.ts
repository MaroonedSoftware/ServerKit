import { CacheProvider } from './cache.provider.js';
import { Injectable } from 'injectkit';
import { Redis } from 'ioredis';
import { Duration } from 'luxon';

/**
 * `CacheProvider` implementation backed by ioredis.
 *
 * Register this class in your DI container and bind an `ioredis` `Redis` instance to it.
 *
 * @example
 * ```typescript
 * import { Redis } from 'ioredis';
 * import { IoRedisCacheProvider } from '@maroonedsoftware/cache';
 *
 * container.bind(Redis).toConstantValue(new Redis(process.env.REDIS_URL));
 * container.bind(CacheProvider).to(IoRedisCacheProvider);
 * ```
 */
@Injectable()
export class IoRedisCacheProvider implements CacheProvider {
  constructor(private readonly redis: Redis) {}

  /** Retrieves the value stored at `key`, or `null` if missing or expired. */
  async get(key: string): Promise<string | null> {
    return await this.redis.get(key);
  }

  /**
   * Stores `value` at `key` with the given TTL using the Redis `EX` flag.
   *
   * The TTL is rounded **up** to whole seconds and clamped to a minimum of 1, since Redis
   * `EX` only accepts positive integers — a sub-second TTL must not collapse to `EX 0`
   * (which Redis rejects).
   */
  async set(key: string, value: string, ttl: Duration): Promise<void> {
    await this.redis.set(key, value, 'EX', toExpirySeconds(ttl));
  }

  /**
   * Atomically stores `value` at `key` only if it does not already exist (Redis `NX`), with
   * an optional expiry (`EX`, rounded up to whole seconds and clamped to at least 1).
   *
   * @returns `true` when the key was created, `false` when it already existed and was left
   *   untouched (Redis returns `null` for a `NX` set that did not apply).
   */
  async add(key: string, value: string, options?: { ttl?: Duration }): Promise<boolean> {
    const result = options?.ttl
      ? await this.redis.set(key, value, 'EX', toExpirySeconds(options.ttl), 'NX')
      : await this.redis.set(key, value, 'NX');
    return result === 'OK';
  }

  /**
   * Removes `key` from Redis.
   * @returns The key string if it existed, or `null` if it was already absent.
   */
  async delete(key: string): Promise<string | null> {
    const result = await this.redis.del(key);
    if (result === 0) {
      return null;
    }
    return key;
  }

  /**
   * Overwrites the value at `key`.
   * When `ttl` is provided the expiry is reset to that duration (`EX`, rounded up to whole
   * seconds, min 1); otherwise the existing TTL is preserved via Redis `KEEPTTL`. The `XX`
   * flag is combined with `KEEPTTL` so the write only applies when the key still exists — a
   * key that has since expired must not be resurrected with no expiry.
   */
  async update(key: string, value: string, ttl?: Duration): Promise<void> {
    if (ttl) {
      await this.redis.set(key, value, 'EX', toExpirySeconds(ttl));
    } else {
      await this.redis.set(key, value, 'KEEPTTL', 'XX');
    }
  }
}

/**
 * Converts a Luxon {@link Duration} to a positive integer second count for Redis `EX`.
 *
 * Rounds up (so a sub-second TTL still expires after ~1s rather than collapsing to 0) and
 * clamps to a minimum of 1, because Redis rejects `EX 0`.
 */
function toExpirySeconds(ttl: Duration): number {
  return Math.max(1, Math.ceil(ttl.as('seconds')));
}
