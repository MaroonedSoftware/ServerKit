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
});
