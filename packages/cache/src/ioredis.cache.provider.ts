import { CacheProvider } from './cache.provider.js';
import { Injectable } from 'injectkit';
import { Redis } from 'ioredis';
import { Duration } from 'luxon';

/**
 * Adds a member to a set and extends the set's expiry without ever shortening it, in one
 * atomic step. `KEYS[1]` is the set; `ARGV[1]` the member; `ARGV[2]`, when present, the
 * minimum remaining lifetime in seconds. A set this call creates has no TTL until the
 * `EXPIRE`, so it is told apart from a pre-existing set without one (which is left alone).
 */
const SET_ADD_SCRIPT = `
local existed = redis.call('EXISTS', KEYS[1])
local added = redis.call('SADD', KEYS[1], ARGV[1])
if ARGV[2] then
  local ttl = tonumber(ARGV[2])
  local current = redis.call('TTL', KEYS[1])
  if existed == 0 or (current >= 0 and current < ttl) then
    redis.call('EXPIRE', KEYS[1], ttl)
  end
end
return added
`;

/**
 * `CacheProvider` implementation backed by ioredis.
 *
 * Register this class in your DI container and bind an `ioredis` `Redis` instance to it.
 *
 * Reachable only via the `@maroonedsoftware/cache/ioredis` subpath — the root barrel does not
 * export it, so importing the core entry never loads the optional `ioredis` peer dependency.
 *
 * @example
 * ```typescript
 * import { Redis } from 'ioredis';
 * import { IoRedisCacheProvider } from '@maroonedsoftware/cache/ioredis';
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
    const result = options?.ttl ? await this.redis.set(key, value, 'EX', toExpirySeconds(options.ttl), 'NX') : await this.redis.set(key, value, 'NX');
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

  /**
   * Adds `member` to the set at `key` with `SADD`, extending its expiry to at least `ttl`
   * (rounded up to whole seconds, min 1). Both run in one Lua script, so the set can never be
   * observed with the member but without the expiry.
   *
   * @returns `true` when the member was added, `false` when it was already present.
   */
  async setAdd(key: string, member: string, options?: { ttl?: Duration }): Promise<boolean> {
    const result = options?.ttl
      ? await this.redis.eval(SET_ADD_SCRIPT, 1, key, member, toExpirySeconds(options.ttl))
      : await this.redis.eval(SET_ADD_SCRIPT, 1, key, member);
    return result === 1;
  }

  /**
   * Removes `member` from the set at `key` with `SREM`. Redis deletes a set once it is empty.
   * @returns `true` when the member was removed, `false` when it was not present.
   */
  async setRemove(key: string, member: string): Promise<boolean> {
    return (await this.redis.srem(key, member)) === 1;
  }

  /** Returns every member of the set at `key` via `SMEMBERS`; empty when the key is absent. */
  async setMembers(key: string): Promise<string[]> {
    return await this.redis.smembers(key);
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
