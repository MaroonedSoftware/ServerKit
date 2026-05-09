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
   * The TTL is rounded to the nearest whole second, since Redis `EX` only accepts integer seconds.
   */
  async set(key: string, value: string, ttl: Duration): Promise<void> {
    await this.redis.set(key, value, 'EX', Math.round(ttl.as('seconds')));
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
   * When `ttl` is provided the expiry is reset to that duration (`EX`, rounded to whole seconds);
   * otherwise the existing TTL is preserved via Redis `KEEPTTL`.
   */
  async update(key: string, value: string, ttl?: Duration): Promise<void> {
    if (ttl) {
      await this.redis.set(key, value, 'EX', Math.round(ttl.as('seconds')));
    } else {
      await this.redis.set(key, value, 'KEEPTTL');
    }
  }
}
