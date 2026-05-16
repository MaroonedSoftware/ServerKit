import { AppConfig } from '@maroonedsoftware/appconfig';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { redisReachable } from '../src/integrations/redis/index.js';
import { createMockContext } from './helpers.js';

interface FakeRedis {
    connect: ReturnType<typeof vi.fn>;
    ping: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
}

const history: Array<{ config: { host: string; port: number }; client: FakeRedis }> = [];
let nextFactory: (() => Partial<FakeRedis>) | undefined;

vi.mock('ioredis', () => {
    class Redis {
        connect: ReturnType<typeof vi.fn>;
        ping: ReturnType<typeof vi.fn>;
        disconnect: ReturnType<typeof vi.fn>;
        constructor(config: { host: string; port: number }) {
            const base: FakeRedis = {
                connect: vi.fn(async () => undefined),
                ping: vi.fn(async () => 'PONG'),
                disconnect: vi.fn(() => undefined),
            };
            const overrides = nextFactory ? nextFactory() : {};
            const merged: FakeRedis = { ...base, ...overrides };
            this.connect = merged.connect;
            this.ping = merged.ping;
            this.disconnect = merged.disconnect;
            history.push({ config, client: merged });
        }
    }
    return { Redis, default: Redis };
});

describe('redisReachable', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        history.length = 0;
        nextFactory = undefined;
    });

    afterEach(() => {
        for (const k of Object.keys(process.env)) if (!(k in originalEnv)) delete process.env[k];
        for (const [k, v] of Object.entries(originalEnv)) process.env[k] = v;
    });

    it('returns ok with the host:port and PONG when reachable', async () => {
        const result = await redisReachable({ host: '127.0.0.1', port: 6379 }).run(createMockContext());
        expect(result.ok).toBe(true);
        expect(result.message).toBe('127.0.0.1:6379 → PONG');
        expect(history[0]?.client.disconnect).toHaveBeenCalled();
    });

    it('defaults to localhost:6379 when no host/port is supplied and config is empty', async () => {
        delete process.env['REDIS_HOST'];
        delete process.env['REDIS_PORT'];
        const ctx = createMockContext();
        ctx.config.getString = ((key: string) => {
            throw new Error(`no ${key}`);
        }) as never;
        ctx.config.getNumber = ((key: string) => {
            throw new Error(`no ${key}`);
        }) as never;
        await redisReachable().run(ctx);
        expect(history[0]?.config).toMatchObject({ host: 'localhost', port: 6379 });
    });

    it('reads host and port from AppConfig keys', async () => {
        await redisReachable().run(createMockContext({ config: new AppConfig({ REDIS_HOST: 'cache', REDIS_PORT: 6400 }) }));
        expect(history[0]?.config).toMatchObject({ host: 'cache', port: 6400 });
    });

    it('falls back to process.env when the config getters throw', async () => {
        process.env['REDIS_HOST'] = 'env-host';
        process.env['REDIS_PORT'] = '6500';
        const ctx = createMockContext();
        ctx.config.getString = ((key: string) => {
            throw new Error(`no ${key}`);
        }) as never;
        ctx.config.getNumber = ((key: string) => {
            throw new Error(`no ${key}`);
        }) as never;
        await redisReachable().run(ctx);
        expect(history[0]?.config).toMatchObject({ host: 'env-host', port: 6500 });
    });

    it('honours custom config keys', async () => {
        await redisReachable({ hostConfigKey: 'CACHE_HOST', portConfigKey: 'CACHE_PORT' }).run(
            createMockContext({ config: new AppConfig({ CACHE_HOST: 'cache2', CACHE_PORT: 6555 }) }),
        );
        expect(history[0]?.config).toMatchObject({ host: 'cache2', port: 6555 });
    });

    it('forwards the timeoutMs option to the ioredis client', async () => {
        await redisReachable({ host: 'x', port: 1, timeoutMs: 4321 }).run(createMockContext());
        expect(history[0]?.config).toMatchObject({ connectTimeout: 4321 });
    });

    it('reports a connection failure with a fixHint and disconnects in the finally', async () => {
        nextFactory = () => ({
            connect: vi.fn(async () => {
                throw new Error('refused');
            }),
        });
        const result = await redisReachable({ host: 'x', port: 1 }).run(createMockContext());
        expect(result.ok).toBe(false);
        expect(result.message).toContain('refused');
        expect(result.fixHint).toContain('docker compose up');
        expect(history[0]?.client.disconnect).toHaveBeenCalled();
    });

    it('returns ok:false when ping returns something other than PONG', async () => {
        nextFactory = () => ({ ping: vi.fn(async () => 'NOPE') });
        const result = await redisReachable({ host: 'x', port: 1 }).run(createMockContext());
        expect(result.ok).toBe(false);
        expect(result.message).toContain('→ NOPE');
    });
});
