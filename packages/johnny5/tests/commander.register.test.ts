import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerCommands } from '../src/commander/register.js';
import { defineCommand } from '../src/index.js';
import type { DiscoveredCommand } from '../src/index.js';
import { createMockContext } from './helpers.js';

const buildProgram = (): Command => new Command().exitOverride().configureOutput({ writeOut: () => {}, writeErr: () => {} });

describe('registerCommands', () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;
    const originalEnv = { ...process.env };

    beforeEach(() => {
        exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`__exit:${code}`);
        }) as never);
    });

    afterEach(() => {
        exitSpy.mockRestore();
        process.env = { ...originalEnv };
    });

    it('registers a leaf command and invokes its handler with parsed options', async () => {
        const run = vi.fn(async () => 0);
        const program = buildProgram();
        const discovered: DiscoveredCommand[] = [
            {
                path: ['hello'],
                source: 'core',
                module: defineCommand({
                    description: 'say hi',
                    options: [{ flags: '--name <name>', description: 'name' }],
                    run,
                }),
            },
        ];
        registerCommands(program, discovered, createMockContext());
        await program.parseAsync(['hello', '--name', 'alice'], { from: 'user' });
        expect(run).toHaveBeenCalledTimes(1);
        expect(run.mock.calls[0]?.[0]).toMatchObject({ name: 'alice' });
    });

    it('builds nested groups for multi-segment paths', async () => {
        const run = vi.fn(async () => 0);
        const program = buildProgram();
        registerCommands(
            program,
            [
                {
                    path: ['db', 'migrate', 'up'],
                    source: 'core',
                    module: defineCommand({ description: 'apply', run }),
                },
            ],
            createMockContext(),
        );
        await program.parseAsync(['db', 'migrate', 'up'], { from: 'user' });
        expect(run).toHaveBeenCalled();
        const db = program.commands.find(c => c.name() === 'db');
        expect(db).toBeDefined();
        const migrate = db?.commands.find(c => c.name() === 'migrate');
        expect(migrate?.commands.find(c => c.name() === 'up')).toBeDefined();
    });

    it('throws when two commands register the same path (plugin tries to override core)', () => {
        const program = buildProgram();
        const discovered: DiscoveredCommand[] = [
            { path: ['hi'], source: 'core', module: defineCommand({ description: 'core hi', run: async () => 0 }) },
            { path: ['hi'], source: 'plugin', sourceName: 'evil-plugin', module: defineCommand({ description: 'plugin hi', run: async () => 0 }) },
        ];
        expect(() => registerCommands(program, discovered, createMockContext())).toThrowError(
            /command "hi" is already registered by core; evil-plugin cannot override it/,
        );
    });

    it('throws when two plugins both claim the same path', () => {
        const program = buildProgram();
        const discovered: DiscoveredCommand[] = [
            { path: ['x'], source: 'plugin', sourceName: 'a', module: defineCommand({ description: '', run: async () => 0 }) },
            { path: ['x'], source: 'plugin', sourceName: 'b', module: defineCommand({ description: '', run: async () => 0 }) },
        ];
        expect(() => registerCommands(program, discovered, createMockContext())).toThrowError(/already registered by a; b cannot override it/);
    });

    it('falls back to the envVar value when an option is not supplied on the CLI', async () => {
        const run = vi.fn(async () => 0);
        process.env['MY_NAME'] = 'from-env';
        const program = buildProgram();
        registerCommands(
            program,
            [
                {
                    path: ['hi'],
                    source: 'core',
                    module: defineCommand({
                        description: 'hi',
                        options: [{ flags: '--name <name>', description: 'name', envVar: 'MY_NAME' }],
                        run,
                    }),
                },
            ],
            createMockContext(),
        );
        await program.parseAsync(['hi'], { from: 'user' });
        expect(run.mock.calls[0]?.[0]).toMatchObject({ name: 'from-env' });
    });

    it('prefers the explicit CLI flag over the envVar fallback', async () => {
        const run = vi.fn(async () => 0);
        process.env['MY_NAME'] = 'from-env';
        const program = buildProgram();
        registerCommands(
            program,
            [
                {
                    path: ['hi'],
                    source: 'core',
                    module: defineCommand({
                        description: 'hi',
                        options: [{ flags: '--name <name>', description: 'name', envVar: 'MY_NAME' }],
                        run,
                    }),
                },
            ],
            createMockContext(),
        );
        await program.parseAsync(['hi', '--name', 'cli-wins'], { from: 'user' });
        expect(run.mock.calls[0]?.[0]).toMatchObject({ name: 'cli-wins' });
    });

    it('derives the camelCase option key from a kebab-case long flag for envVar fallback', async () => {
        const run = vi.fn(async () => 0);
        process.env['ORG_NAME'] = 'acme';
        const program = buildProgram();
        registerCommands(
            program,
            [
                {
                    path: ['hi'],
                    source: 'core',
                    module: defineCommand({
                        description: 'hi',
                        options: [{ flags: '--org-name <name>', description: 'org', envVar: 'ORG_NAME' }],
                        run,
                    }),
                },
            ],
            createMockContext(),
        );
        await program.parseAsync(['hi'], { from: 'user' });
        expect(run.mock.calls[0]?.[0]).toMatchObject({ orgName: 'acme' });
    });

    it('invokes the interactive hook only when the context is interactive', async () => {
        const interactive = vi.fn(async () => ({ name: 'from-prompt' }));
        const run = vi.fn(async () => 0);
        const program = buildProgram();
        registerCommands(
            program,
            [
                {
                    path: ['hi'],
                    source: 'core',
                    module: { description: 'hi', interactive, run },
                },
            ],
            createMockContext({ isInteractive: () => true }),
        );
        await program.parseAsync(['hi'], { from: 'user' });
        expect(interactive).toHaveBeenCalled();
        expect(run.mock.calls[0]?.[0]).toMatchObject({ name: 'from-prompt' });
    });

    it('skips the interactive hook when isInteractive returns false', async () => {
        const interactive = vi.fn(async () => ({ name: 'prompted' }));
        const run = vi.fn(async () => 0);
        const program = buildProgram();
        registerCommands(
            program,
            [
                {
                    path: ['hi'],
                    source: 'core',
                    module: { description: 'hi', interactive, run },
                },
            ],
            createMockContext({ isInteractive: () => false }),
        );
        await program.parseAsync(['hi'], { from: 'user' });
        expect(interactive).not.toHaveBeenCalled();
    });

    it('passes positional args through to run', async () => {
        const run = vi.fn(async () => 0);
        const program = buildProgram();
        registerCommands(
            program,
            [
                {
                    path: ['greet'],
                    source: 'core',
                    module: defineCommand({
                        description: 'greet',
                        args: [{ name: 'who', description: 'recipient', required: true }],
                        run,
                    }),
                },
            ],
            createMockContext(),
        );
        await program.parseAsync(['greet', 'world'], { from: 'user' });
        expect(run.mock.calls[0]?.[2]).toEqual(['world']);
    });

    it('forwards unknown args verbatim when passthrough is true', async () => {
        const run = vi.fn(async () => 0);
        const program = buildProgram();
        registerCommands(
            program,
            [
                {
                    path: ['proxy'],
                    source: 'core',
                    module: defineCommand({ description: 'proxy', passthrough: true, run }),
                },
            ],
            createMockContext(),
        );
        await program.parseAsync(['proxy', '--unknown', 'flag', 'extra'], { from: 'user' });
        expect(run.mock.calls[0]?.[2]).toEqual(['--unknown', 'flag', 'extra']);
    });

    it('calls process.exit(nonZero) when run returns a non-zero exit code', async () => {
        // For this test we need process.exit to NOT throw — otherwise the
        // commander action's own try/catch swallows the throw and we get a
        // second process.exit(1) from the catch branch.
        exitSpy.mockRestore();
        const calls: number[] = [];
        exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            calls.push(code ?? 0);
        }) as never);

        const program = buildProgram();
        registerCommands(
            program,
            [
                {
                    path: ['fail'],
                    source: 'core',
                    module: defineCommand({ description: 'fail', run: async () => 3 }),
                },
            ],
            createMockContext(),
        );
        await program.parseAsync(['fail'], { from: 'user' });
        expect(calls).toEqual([3]);
    });

    it('does not call process.exit when run returns 0 or void', async () => {
        const program = buildProgram();
        registerCommands(
            program,
            [
                {
                    path: ['ok'],
                    source: 'core',
                    module: defineCommand({ description: 'ok', run: async () => 0 }),
                },
            ],
            createMockContext(),
        );
        await program.parseAsync(['ok'], { from: 'user' });
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it('logs the error and exits 1 when the handler throws', async () => {
        const ctx = createMockContext();
        const program = buildProgram();
        registerCommands(
            program,
            [
                {
                    path: ['boom'],
                    source: 'plugin',
                    sourceName: 'sandbox',
                    module: defineCommand({
                        description: 'boom',
                        run: async () => {
                            throw new Error('handler exploded');
                        },
                    }),
                },
            ],
            ctx,
        );
        await expect(program.parseAsync(['boom'], { from: 'user' })).rejects.toThrow('__exit:1');
        expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining('[sandbox] handler exploded'));
    });
});
