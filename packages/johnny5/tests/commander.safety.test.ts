import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext } from './helpers.js';

// Mock @clack/prompts BEFORE the safety module imports it, so its
// `prompts.*` calls hit our spies.
const CANCEL = Symbol('test-cancel-sentinel');
const confirmMock = vi.fn();
const textMock = vi.fn();
vi.mock('@clack/prompts', () => ({
    isCancel: (value: unknown) => value === CANCEL,
    confirm: (...args: unknown[]) => confirmMock(...args),
    text: (...args: unknown[]) => textMock(...args),
}));

const { registerCommands } = await import('../src/commander/register.js');
const { defineCommand } = await import('../src/index.js');
type DiscoveredCommand = import('../src/index.js').DiscoveredCommand;

const buildProgram = (): Command => new Command().exitOverride().configureOutput({ writeOut: () => {}, writeErr: () => {} });

describe('command safety guards', () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        confirmMock.mockReset();
        textMock.mockReset();
        exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`__exit:${code}`);
        }) as never);
    });

    afterEach(() => {
        exitSpy.mockRestore();
    });

    describe('allowedEnvironments', () => {
        it('runs when NODE_ENV is in the allowed list', async () => {
            const run = vi.fn(async () => 0);
            const program = buildProgram();
            const discovered: DiscoveredCommand[] = [
                {
                    path: ['migrate'],
                    source: 'core',
                    module: defineCommand({ description: 'migrate', allowedEnvironments: ['development', 'staging'], run }),
                },
            ];
            registerCommands(program, discovered, createMockContext({ env: { NODE_ENV: 'staging' } }));
            await program.parseAsync(['migrate'], { from: 'user' });
            expect(run).toHaveBeenCalled();
        });

        it('refuses to run when NODE_ENV is outside the allowed list', async () => {
            const run = vi.fn(async () => 0);
            const ctx = createMockContext({ env: { NODE_ENV: 'production' } });
            const program = buildProgram();
            registerCommands(
                program,
                [
                    {
                        path: ['reset'],
                        source: 'core',
                        module: defineCommand({ description: 'reset', allowedEnvironments: ['development'], run }),
                    },
                ],
                ctx,
            );
            await expect(program.parseAsync(['reset'], { from: 'user' })).rejects.toThrow('__exit:1');
            expect(run).not.toHaveBeenCalled();
            expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining('NODE_ENV=production'));
        });

        it('refuses when the env var is unset', async () => {
            const run = vi.fn(async () => 0);
            const ctx = createMockContext({ env: {} });
            const program = buildProgram();
            registerCommands(
                program,
                [
                    {
                        path: ['reset'],
                        source: 'core',
                        module: defineCommand({ description: 'reset', allowedEnvironments: ['development'], run }),
                    },
                ],
                ctx,
            );
            await expect(program.parseAsync(['reset'], { from: 'user' })).rejects.toThrow('__exit:1');
            expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining('NODE_ENV=(unset)'));
        });

        it('honours a custom variable name in the spec form', async () => {
            const run = vi.fn(async () => 0);
            const ctx = createMockContext({ env: { APP_ENV: 'prod' } });
            const program = buildProgram();
            registerCommands(
                program,
                [
                    {
                        path: ['reset'],
                        source: 'core',
                        module: defineCommand({
                            description: 'reset',
                            allowedEnvironments: { allowed: ['dev'], variable: 'APP_ENV' },
                            run,
                        }),
                    },
                ],
                ctx,
            );
            await expect(program.parseAsync(['reset'], { from: 'user' })).rejects.toThrow('__exit:1');
            expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining('APP_ENV=prod'));
        });
    });

    describe('dangerous', () => {
        it('prompts for yes/no confirmation in interactive mode and runs when confirmed', async () => {
            confirmMock.mockResolvedValueOnce(true);
            const run = vi.fn(async () => 0);
            const program = buildProgram();
            registerCommands(
                program,
                [
                    {
                        path: ['db', 'drop'],
                        source: 'core',
                        module: defineCommand({ description: 'drop db', dangerous: true, run }),
                    },
                ],
                createMockContext({ isInteractive: () => true }),
            );
            await program.parseAsync(['db', 'drop'], { from: 'user' });
            expect(confirmMock).toHaveBeenCalledTimes(1);
            expect(run).toHaveBeenCalledTimes(1);
        });

        it('aborts with exit 1 when the user declines the prompt', async () => {
            confirmMock.mockResolvedValueOnce(false);
            const run = vi.fn(async () => 0);
            const program = buildProgram();
            registerCommands(
                program,
                [
                    {
                        path: ['db', 'drop'],
                        source: 'core',
                        module: defineCommand({ description: 'drop db', dangerous: true, run }),
                    },
                ],
                createMockContext({ isInteractive: () => true }),
            );
            await expect(program.parseAsync(['db', 'drop'], { from: 'user' })).rejects.toThrow('__exit:1');
            expect(run).not.toHaveBeenCalled();
        });

        it('aborts when the user cancels the prompt', async () => {
            confirmMock.mockResolvedValueOnce(CANCEL);
            const run = vi.fn(async () => 0);
            const program = buildProgram();
            registerCommands(
                program,
                [
                    {
                        path: ['db', 'drop'],
                        source: 'core',
                        module: defineCommand({ description: 'drop db', dangerous: true, run }),
                    },
                ],
                createMockContext({ isInteractive: () => true }),
            );
            await expect(program.parseAsync(['db', 'drop'], { from: 'user' })).rejects.toThrow('__exit:1');
            expect(run).not.toHaveBeenCalled();
        });

        it('requires --yes in non-interactive contexts', async () => {
            const run = vi.fn(async () => 0);
            const ctx = createMockContext({ isInteractive: () => false });
            const program = buildProgram();
            registerCommands(
                program,
                [
                    {
                        path: ['db', 'drop'],
                        source: 'core',
                        module: defineCommand({ description: 'drop db', dangerous: true, run }),
                    },
                ],
                ctx,
            );
            await expect(program.parseAsync(['db', 'drop'], { from: 'user' })).rejects.toThrow('__exit:1');
            expect(run).not.toHaveBeenCalled();
            expect(ctx.logger.error).toHaveBeenCalledWith(expect.stringContaining('pass --yes'));
        });

        it('bypasses the prompt when --yes is supplied', async () => {
            const run = vi.fn(async () => 0);
            const program = buildProgram();
            registerCommands(
                program,
                [
                    {
                        path: ['db', 'drop'],
                        source: 'core',
                        module: defineCommand({ description: 'drop db', dangerous: true, run }),
                    },
                ],
                createMockContext({ isInteractive: () => false }),
            );
            await program.parseAsync(['db', 'drop', '--yes'], { from: 'user' });
            expect(confirmMock).not.toHaveBeenCalled();
            expect(run).toHaveBeenCalledTimes(1);
        });

        it('runs when typed confirmation matches the default phrase (the command path)', async () => {
            textMock.mockResolvedValueOnce('db drop');
            const run = vi.fn(async () => 0);
            const program = buildProgram();
            registerCommands(
                program,
                [
                    {
                        path: ['db', 'drop'],
                        source: 'core',
                        module: defineCommand({ description: 'drop db', dangerous: { confirm: 'typed' }, run }),
                    },
                ],
                createMockContext({ isInteractive: () => true }),
            );
            await program.parseAsync(['db', 'drop'], { from: 'user' });
            expect(textMock).toHaveBeenCalledTimes(1);
            expect(run).toHaveBeenCalledTimes(1);
        });

        it('aborts when typed confirmation does not match', async () => {
            textMock.mockResolvedValueOnce('nope');
            const run = vi.fn(async () => 0);
            const ctx = createMockContext({ isInteractive: () => true });
            const program = buildProgram();
            registerCommands(
                program,
                [
                    {
                        path: ['db', 'drop'],
                        source: 'core',
                        module: defineCommand({
                            description: 'drop db',
                            dangerous: { confirm: 'typed', phrase: 'DROP PRODUCTION' },
                            run,
                        }),
                    },
                ],
                ctx,
            );
            await expect(program.parseAsync(['db', 'drop'], { from: 'user' })).rejects.toThrow('__exit:1');
            expect(run).not.toHaveBeenCalled();
            expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('did not match'));
        });

        it('does not auto-inject --yes when the command already declares one', async () => {
            confirmMock.mockResolvedValueOnce(true);
            const run = vi.fn(async () => 0);
            const program = buildProgram();
            registerCommands(
                program,
                [
                    {
                        path: ['risky'],
                        source: 'core',
                        module: defineCommand({
                            description: 'risky',
                            dangerous: true,
                            options: [{ flags: '-y, --yes', description: 'agree', type: 'boolean' }],
                            run,
                        }),
                    },
                ],
                createMockContext({ isInteractive: () => true }),
            );
            // commander throws on duplicate option registration; reaching the
            // action means the auto-inject was correctly skipped.
            await program.parseAsync(['risky'], { from: 'user' });
            expect(run).toHaveBeenCalled();
        });

        it('runs env guard before the dangerous prompt', async () => {
            const run = vi.fn(async () => 0);
            const ctx = createMockContext({ env: { NODE_ENV: 'production' }, isInteractive: () => true });
            const program = buildProgram();
            registerCommands(
                program,
                [
                    {
                        path: ['db', 'drop'],
                        source: 'core',
                        module: defineCommand({
                            description: 'drop db',
                            dangerous: true,
                            allowedEnvironments: ['development'],
                            run,
                        }),
                    },
                ],
                ctx,
            );
            await expect(program.parseAsync(['db', 'drop'], { from: 'user' })).rejects.toThrow('__exit:1');
            expect(confirmMock).not.toHaveBeenCalled();
            expect(run).not.toHaveBeenCalled();
        });
    });
});
