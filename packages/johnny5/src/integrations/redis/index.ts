import type { Check } from '../../types.js';

/** Options for `redisReachable`. */
export interface RedisReachableOptions {
    /** Direct override for the Redis host. Takes precedence over `hostConfigKey` / env. */
    host?: string;
    /** Direct override for the Redis port. Takes precedence over `portConfigKey` / env. */
    port?: number;
    /**
     * Optional AppConfig keys to read host/port from when they aren't supplied
     * directly. Default: `'REDIS_HOST'`, `'REDIS_PORT'`. Falls back to the
     * matching `process.env` entry when the config getter throws.
     */
    hostConfigKey?: string;
    portConfigKey?: string;
    /** Connection timeout in milliseconds. Defaults to `2000`. */
    timeoutMs?: number;
}

const readConfigString = (ctx: { config: { getString: (key: string) => string } }, key: string): string | undefined => {
    try {
        return ctx.config.getString(key);
    } catch {
        return process.env[key];
    }
};

const readConfigNumber = (ctx: { config: { getNumber: (key: string) => number } }, key: string): number | undefined => {
    try {
        return ctx.config.getNumber(key);
    } catch {
        const raw = process.env[key];
        return raw ? Number(raw) : undefined;
    }
};

/**
 * Check that Redis is reachable and answers `PING`. Lazily loads `ioredis` so
 * consumers who don't need the check don't pay the import cost. Returns a
 * failing result with a clear message when `ioredis` isn't installed.
 */
export const redisReachable = (options: RedisReachableOptions = {}): Check => ({
    name: 'redis reachable',
    run: async ctx => {
        let RedisCtor: typeof import('ioredis').Redis;
        try {
            const mod = await import('ioredis');
            RedisCtor = mod.Redis;
        } catch {
            return { ok: false, message: '`ioredis` is not installed; add it as a dependency to use this check' };
        }

        const host = options.host ?? readConfigString(ctx, options.hostConfigKey ?? 'REDIS_HOST') ?? 'localhost';
        const port = options.port ?? readConfigNumber(ctx, options.portConfigKey ?? 'REDIS_PORT') ?? 6379;

        const redis = new RedisCtor({
            host,
            port,
            lazyConnect: true,
            connectTimeout: options.timeoutMs ?? 2000,
            maxRetriesPerRequest: 1,
            retryStrategy: () => null,
        });
        try {
            await redis.connect();
            const pong = await redis.ping();
            return { ok: pong === 'PONG', message: `${host}:${port} → ${pong}` };
        } catch (err) {
            return {
                ok: false,
                message: `${host}:${port} unreachable: ${(err as Error).message}`,
                fixHint: 'Start Redis (`docker compose up -d`) or set the host/port options.',
            };
        } finally {
            redis.disconnect();
        }
    },
});
