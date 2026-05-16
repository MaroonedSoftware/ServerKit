import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCliApp, defineCommand } from '../src/index.js';

describe('createCliApp', () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let stdoutSpy: ReturnType<typeof vi.spyOn>;
    let stderrSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`__exit:${code}`);
        }) as never);
        stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
        exitSpy.mockRestore();
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
    });

    it('returns 0 from app.run when a registered command succeeds', async () => {
        const run = vi.fn(async () => undefined);
        const app = await createCliApp({
            name: 'cli',
            description: 'd',
            version: '0.0.0',
            commands: [{ path: ['hello'], module: defineCommand({ description: 'hi', run }) }],
        });
        const exitCode = await app.run(['node', 'cli', 'hello']);
        expect(exitCode).toBe(0);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('returns 1 and logs the error when commander throws (e.g. unknown command)', async () => {
        const logger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            success: vi.fn(),
        };
        const app = await createCliApp({
            name: 'cli',
            description: 'd',
            version: '0.0.0',
            commands: [{ path: ['hello'], module: defineCommand({ description: 'hi', run: async () => 0 }) }],
            logger,
        });
        const exitCode = await app.run(['node', 'cli', 'no-such-command']);
        expect(exitCode).toBe(1);
        expect(logger.error).toHaveBeenCalled();
    });

    it('auto-registers a doctor command when checks are supplied', async () => {
        const run = vi.fn(async () => ({ ok: true, message: 'fine' }));
        const app = await createCliApp({
            name: 'cli',
            description: 'd',
            version: '0.0.0',
            commands: [],
            checks: [{ name: 'noop', run }],
        });
        const exitCode = await app.run(['node', 'cli', 'doctor']);
        expect(exitCode).toBe(0);
        expect(run).toHaveBeenCalled();
    });

    it('respects a custom doctorCommandPath', async () => {
        const run = vi.fn(async () => ({ ok: true, message: 'fine' }));
        const app = await createCliApp({
            name: 'cli',
            description: 'd',
            version: '0.0.0',
            commands: [],
            checks: [{ name: 'noop', run }],
            doctorCommandPath: ['health'],
        });
        const exitCode = await app.run(['node', 'cli', 'health']);
        expect(exitCode).toBe(0);
        expect(run).toHaveBeenCalled();
    });

    it('does not register the built-in doctor when doctorCommandPath is null', async () => {
        const logger = {
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            success: vi.fn(),
        };
        const app = await createCliApp({
            name: 'cli',
            description: 'd',
            version: '0.0.0',
            commands: [],
            checks: [{ name: 'noop', run: async () => ({ ok: true, message: '' }) }],
            doctorCommandPath: null,
            logger,
        });
        // doctor is not registered → unknown command → app.run returns 1.
        const exitCode = await app.run(['node', 'cli', 'doctor']);
        expect(exitCode).toBe(1);
    });

    it('skips the auto-registered doctor when the consumer has already supplied one', async () => {
        const consumerDoctor = vi.fn(async () => 0);
        const check = vi.fn(async () => ({ ok: true, message: '' }));
        const app = await createCliApp({
            name: 'cli',
            description: 'd',
            version: '0.0.0',
            commands: [{ path: ['doctor'], module: defineCommand({ description: 'custom', run: consumerDoctor }) }],
            checks: [{ name: 'core', run: check }],
        });
        const exitCode = await app.run(['node', 'cli', 'doctor']);
        expect(exitCode).toBe(0);
        expect(consumerDoctor).toHaveBeenCalled();
        expect(check).not.toHaveBeenCalled();
    });

    it('accepts a config factory that resolves before context is built', async () => {
        const factory = vi.fn(async () => undefined as never);
        await createCliApp({
            name: 'cli',
            description: 'd',
            version: '0.0.0',
            commands: [],
            config: factory,
        });
        expect(factory).toHaveBeenCalledTimes(1);
    });
});

describe('defineCommand', () => {
    it('is an identity helper used for type inference', () => {
        const mod = { description: 'noop', run: async () => 0 };
        expect(defineCommand(mod)).toBe(mod);
    });
});
