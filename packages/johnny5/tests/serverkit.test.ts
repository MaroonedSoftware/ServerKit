import { AppConfig } from '@maroonedsoftware/appconfig';
import { describe, expect, it, vi } from 'vitest';
import {
    bootstrapForCli,
    configureServerKitModules,
    getOrBootstrapContainer,
    requireContainer,
} from '../src/integrations/serverkit/index.js';
import { createMockContext } from './helpers.js';

interface FakeModule {
    name?: string;
    setup: ReturnType<typeof vi.fn>;
    start?: ReturnType<typeof vi.fn>;
    shutdown?: ReturnType<typeof vi.fn>;
}

const fakeModule = (overrides: Partial<FakeModule> = {}): FakeModule => ({
    setup: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
    ...overrides,
});

describe('bootstrapForCli', () => {
    it('runs each module.setup but never module.start', async () => {
        const a = fakeModule({ name: 'a' });
        const b = fakeModule({ name: 'b' });
        const config = new AppConfig({});
        const { container } = await bootstrapForCli({ modules: [a, b] as never, config });
        expect(a.setup).toHaveBeenCalledTimes(1);
        expect(b.setup).toHaveBeenCalledTimes(1);
        expect(a.start).not.toHaveBeenCalled();
        expect(b.start).not.toHaveBeenCalled();
        // setup() receives (registry, config) — the registry is opaque from here
        // but config must be the same instance.
        expect(a.setup.mock.calls[0]?.[1]).toBe(config);
        expect(container).toBeDefined();
    });

    it('shutdown invokes module.shutdown in reverse order', async () => {
        const order: string[] = [];
        const a = fakeModule({ name: 'a', shutdown: vi.fn(async () => void order.push('a')) });
        const b = fakeModule({ name: 'b', shutdown: vi.fn(async () => void order.push('b')) });
        const { shutdown } = await bootstrapForCli({ modules: [a, b] as never, config: new AppConfig({}) });
        await shutdown();
        expect(order).toEqual(['b', 'a']);
    });

    it('swallows errors thrown by individual module shutdowns', async () => {
        const a = fakeModule({
            shutdown: vi.fn(async () => {
                throw new Error('a failed');
            }),
        });
        const b = fakeModule({ shutdown: vi.fn(async () => undefined) });
        const { shutdown } = await bootstrapForCli({ modules: [a, b] as never, config: new AppConfig({}) });
        await expect(shutdown()).resolves.toBeUndefined();
        expect(b.shutdown).toHaveBeenCalled();
    });

    it('skips modules without a setup or shutdown hook gracefully', async () => {
        const bare = { name: 'bare' } as unknown as Parameters<typeof bootstrapForCli>[0]['modules'][number];
        const { shutdown } = await bootstrapForCli({ modules: [bare], config: new AppConfig({}) });
        await expect(shutdown()).resolves.toBeUndefined();
    });
});

describe('configureServerKitModules / getOrBootstrapContainer', () => {
    it('throws when called for a context that was never configured', async () => {
        const ctx = createMockContext();
        await expect(getOrBootstrapContainer(ctx)).rejects.toThrow(/configureServerKitModules/);
    });

    it('caches the bootstrap result across calls on the same context', async () => {
        const mod = fakeModule();
        const ctx = createMockContext({ config: new AppConfig({}) });
        configureServerKitModules(ctx, [mod] as never);
        const first = await getOrBootstrapContainer(ctx);
        const second = await getOrBootstrapContainer(ctx);
        expect(first).toBe(second);
        // setup ran exactly once across both calls.
        expect(mod.setup).toHaveBeenCalledTimes(1);
    });

    it('bootstraps fresh state for a distinct context', async () => {
        const modA = fakeModule();
        const modB = fakeModule();
        const ctxA = createMockContext({ config: new AppConfig({}) });
        const ctxB = createMockContext({ config: new AppConfig({}) });
        configureServerKitModules(ctxA, [modA] as never);
        configureServerKitModules(ctxB, [modB] as never);
        await getOrBootstrapContainer(ctxA);
        await getOrBootstrapContainer(ctxB);
        expect(modA.setup).toHaveBeenCalledTimes(1);
        expect(modB.setup).toHaveBeenCalledTimes(1);
    });
});

describe('requireContainer', () => {
    it('hands the wrapped handler a scoped container per invocation', async () => {
        const mod = fakeModule();
        const ctx = createMockContext({ config: new AppConfig({}) });
        configureServerKitModules(ctx, [mod] as never);

        const seenContainers: unknown[] = [];
        const wrapped = requireContainer(async (_opts, enrichedCtx) => {
            seenContainers.push(enrichedCtx.container);
            return 0;
        });

        await wrapped({}, ctx, []);
        await wrapped({}, ctx, []);

        expect(seenContainers).toHaveLength(2);
        expect(seenContainers[0]).toBeDefined();
        // Each invocation should produce a fresh scoped container.
        expect(seenContainers[0]).not.toBe(seenContainers[1]);
    });

    it('forwards opts and args to the wrapped handler', async () => {
        const mod = fakeModule();
        const ctx = createMockContext({ config: new AppConfig({}) });
        configureServerKitModules(ctx, [mod] as never);

        const handler = vi.fn(async () => 0);
        const wrapped = requireContainer(handler);
        await wrapped({ flag: true }, ctx, ['arg1', 'arg2']);

        expect(handler.mock.calls[0]?.[0]).toEqual({ flag: true });
        expect(handler.mock.calls[0]?.[2]).toEqual(['arg1', 'arg2']);
    });
});
