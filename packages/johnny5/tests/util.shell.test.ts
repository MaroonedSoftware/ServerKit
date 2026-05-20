import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { createShell } from '../src/util/shell.js';
import { createMockLogger } from './helpers.js';

describe('createShell', () => {
    it('runs a real binary with the supplied cwd', async () => {
        const shell = createShell(process.cwd(), createMockLogger());
        const result = await shell.run('node', ['-e', 'process.stdout.write("hi")']);
        expect(result.exitCode).toBe(0);
        expect(String(result.stdout)).toBe('hi');
    });

    it('logs the command to debug and returns the exit code from runStreaming', async () => {
        const logger = createMockLogger();
        const shell = createShell(process.cwd(), logger);
        const exit = await shell.runStreaming('node', ['-e', 'process.exit(0)']);
        expect(exit).toBe(0);
        expect(logger.debug).toHaveBeenCalledWith('$ node -e process.exit(0)');
    });

    it('returns the child exit code rather than throwing on non-zero exit', async () => {
        const shell = createShell(process.cwd(), createMockLogger());
        const exit = await shell.runStreaming('node', ['-e', 'process.exit(7)']);
        expect(exit).toBe(7);
    });

    it('forwards arbitrary options to execa', async () => {
        const shell = createShell(process.cwd(), createMockLogger());
        const result = await shell.run('node', ['-e', 'process.stdout.write(process.env.FOO ?? "")'], { env: { FOO: 'bar' } });
        expect(String(result.stdout)).toBe('bar');
    });

    it('runStreaming returns a numeric exit code even for trivial commands', async () => {
        const logger = createMockLogger();
        const shell = createShell(process.cwd(), logger);
        const exit = await shell.runStreaming('node', ['-e', '']);
        expect(typeof exit).toBe('number');
    });

    it('runDetached spawns the process and returns its pid without blocking', async () => {
        const dir = mkdtempSync(resolve(tmpdir(), 'johnny5-shell-'));
        try {
            const logFile = resolve(dir, 'out.log');
            const shell = createShell(process.cwd(), createMockLogger());
            const handle = shell.runDetached('node', ['-e', 'console.log("hello"); setTimeout(()=>process.exit(0), 50)'], { logFile });
            expect(typeof handle.pid).toBe('number');
            expect(handle.logFile).toBe(logFile);
            // Give the child a moment to flush stdout to the log file.
            await wait(300);
            expect(existsSync(logFile)).toBe(true);
            expect(readFileSync(logFile, 'utf-8')).toContain('hello');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
