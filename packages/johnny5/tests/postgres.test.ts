import { AppConfig } from '@maroonedsoftware/appconfig';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postgresReachable } from '../src/integrations/postgres/index.js';
import { createMockContext } from './helpers.js';

interface FakeClient {
    connect: ReturnType<typeof vi.fn>;
    query: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
}

const clientHistory: FakeClient[] = [];
let nextClientFactory: ((config: { connectionString?: string; connectionTimeoutMillis?: number }) => FakeClient) | undefined;

vi.mock('pg', () => {
    class Client {
        connect: ReturnType<typeof vi.fn>;
        query: ReturnType<typeof vi.fn>;
        end: ReturnType<typeof vi.fn>;
        constructor(config: { connectionString?: string; connectionTimeoutMillis?: number }) {
            const instance = nextClientFactory ? nextClientFactory(config) : {
                connect: vi.fn(async () => undefined),
                query: vi.fn(async () => ({ rows: [{ version: 'PostgreSQL 16.0 default' }] })),
                end: vi.fn(async () => undefined),
            };
            this.connect = instance.connect;
            this.query = instance.query;
            this.end = instance.end;
            clientHistory.push(this);
        }
    }
    return { default: { Client }, Client };
});

describe('postgresReachable', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        clientHistory.length = 0;
        nextClientFactory = undefined;
    });

    afterEach(() => {
        for (const k of Object.keys(process.env)) if (!(k in originalEnv)) delete process.env[k];
        for (const [k, v] of Object.entries(originalEnv)) process.env[k] = v;
    });

    it('returns ok with a shortened version when the query succeeds', async () => {
        const result = await postgresReachable({ connectionString: 'postgres://x' }).run(createMockContext());
        expect(result.ok).toBe(true);
        expect(result.message).toBe('PostgreSQL 16.0');
        expect(clientHistory[0]?.connect).toHaveBeenCalled();
        expect(clientHistory[0]?.end).toHaveBeenCalled();
    });

    const captureConnectionStrings = (): Array<string | undefined> => {
        const seen: Array<string | undefined> = [];
        nextClientFactory = config => {
            seen.push(config.connectionString);
            return {
                connect: vi.fn(async () => undefined),
                query: vi.fn(async () => ({ rows: [{ version: 'PostgreSQL 16.0' }] })),
                end: vi.fn(async () => undefined),
            };
        };
        return seen;
    };

    it('uses the explicit connectionString in preference to config / env', async () => {
        process.env['DATABASE_URL'] = 'postgres://fromenv';
        const seen = captureConnectionStrings();
        await postgresReachable({ connectionString: 'postgres://explicit' }).run(
            createMockContext({ config: new AppConfig({ DATABASE_URL: 'postgres://fromconfig' }) }),
        );
        expect(seen[0]).toBe('postgres://explicit');
    });

    it('prefers the config value over process.env', async () => {
        process.env['DATABASE_URL'] = 'postgres://fromenv';
        const seen = captureConnectionStrings();
        await postgresReachable().run(createMockContext({ config: new AppConfig({ DATABASE_URL: 'postgres://fromconfig' }) }));
        expect(seen[0]).toBe('postgres://fromconfig');
    });

    it('falls back to process.env when the configKey is absent on AppConfig', async () => {
        // Regression: AppConfig coerces a missing key to the literal string
        // 'undefined' instead of throwing, which used to win over the env var
        // and send the check to a bogus host.
        process.env['DATABASE_URL'] = 'postgres://fromenv';
        const seen = captureConnectionStrings();
        const result = await postgresReachable().run(createMockContext());
        expect(result.ok).toBe(true);
        expect(seen[0]).toBe('postgres://fromenv');
    });

    it('falls back to process.env when the config getter throws', async () => {
        process.env['DATABASE_URL'] = 'postgres://fromenv';
        const seen = captureConnectionStrings();
        const ctx = createMockContext();
        ctx.config.getAs = ((key: string) => {
            throw new Error(`no ${key}`);
        }) as never;
        const result = await postgresReachable().run(ctx);
        expect(result.ok).toBe(true);
        expect(seen[0]).toBe('postgres://fromenv');
    });

    it('fails with a clear message when neither config nor env have the key', async () => {
        delete process.env['DATABASE_URL'];
        const result = await postgresReachable().run(createMockContext());
        expect(result.ok).toBe(false);
        expect(result.message).toBe('DATABASE_URL is not set');
        expect(clientHistory).toHaveLength(0);
    });

    it('fails with a clear message for a custom configKey that is set nowhere', async () => {
        delete process.env['NEVER_SET_PG_URL'];
        const result = await postgresReachable({ configKey: 'NEVER_SET_PG_URL' }).run(createMockContext());
        expect(result.ok).toBe(false);
        expect(result.message).toBe('NEVER_SET_PG_URL is not set');
    });

    it('returns a connection-failed result with a fixHint on connect errors', async () => {
        nextClientFactory = () => ({
            connect: vi.fn(async () => {
                throw new Error('ECONNREFUSED');
            }),
            query: vi.fn(),
            end: vi.fn(async () => undefined),
        });
        const result = await postgresReachable({ connectionString: 'postgres://nowhere' }).run(createMockContext());
        expect(result.ok).toBe(false);
        expect(result.message).toContain('ECONNREFUSED');
        expect(result.fixHint).toContain('docker compose up');
        // end() is still called in the finally even when connect throws.
        expect(clientHistory[0]?.end).toHaveBeenCalled();
    });

    it('swallows errors from end() during cleanup', async () => {
        nextClientFactory = () => ({
            connect: vi.fn(async () => undefined),
            query: vi.fn(async () => ({ rows: [{ version: 'PostgreSQL 1' }] })),
            end: vi.fn(async () => {
                throw new Error('end failed');
            }),
        });
        await expect(postgresReachable({ connectionString: 'postgres://x' }).run(createMockContext())).resolves.toMatchObject({
            ok: true,
        });
    });

    it('passes the timeout through to the Client constructor', async () => {
        const seen: Array<{ connectionTimeoutMillis?: number }> = [];
        nextClientFactory = config => {
            seen.push(config);
            return {
                connect: vi.fn(async () => undefined),
                query: vi.fn(async () => ({ rows: [{ version: 'PostgreSQL 1' }] })),
                end: vi.fn(async () => undefined),
            };
        };
        await postgresReachable({ connectionString: 'postgres://x', timeoutMs: 1234 }).run(createMockContext());
        expect(seen[0]?.connectionTimeoutMillis).toBe(1234);
    });
});
