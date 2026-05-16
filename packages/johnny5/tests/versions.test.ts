import { describe, expect, it, vi } from 'vitest';
import { nodeVersion, pnpmVersion } from '../src/integrations/versions/index.js';
import { createMockContext } from './helpers.js';

describe('nodeVersion', () => {
    it('passes when the current Node major matches the min', async () => {
        const check = nodeVersion({ min: 1 });
        const result = await check.run(createMockContext());
        expect(result.ok).toBe(true);
        expect(result.message).toMatch(/^Node /);
    });

    it('fails when the current Node major is below the min', async () => {
        const check = nodeVersion({ min: 9999 });
        const result = await check.run(createMockContext());
        expect(result.ok).toBe(false);
        expect(result.fixHint).toContain('Install Node 9999+');
    });
});

describe('pnpmVersion', () => {
    it('returns the installed pnpm version when only presence is required', async () => {
        const run = vi.fn(async () => ({ stdout: '10.24.0\n' }) as never);
        const ctx = createMockContext({ shell: { run } });
        const result = await pnpmVersion().run(ctx);
        expect(run).toHaveBeenCalledWith('pnpm', ['--version']);
        expect(result.ok).toBe(true);
        expect(result.message).toBe('pnpm 10.24.0');
    });

    it('fails with a helpful fixHint when pnpm is not on PATH', async () => {
        const run = vi.fn(async () => {
            throw new Error('ENOENT');
        });
        const ctx = createMockContext({ shell: { run: run as never } });
        const result = await pnpmVersion().run(ctx);
        expect(result.ok).toBe(false);
        expect(result.fixHint).toContain('corepack');
    });

    it('fails when expected version differs from installed', async () => {
        const run = vi.fn(async () => ({ stdout: '10.24.0' }) as never);
        const ctx = createMockContext({ shell: { run } });
        const result = await pnpmVersion({ expected: '9.0.0' }).run(ctx);
        expect(result.ok).toBe(false);
        expect(result.message).toContain('expected 9.0.0');
        expect(result.fixHint).toContain('corepack prepare pnpm@9.0.0');
    });

    it('passes when expected version matches installed', async () => {
        const run = vi.fn(async () => ({ stdout: '10.24.0' }) as never);
        const ctx = createMockContext({ shell: { run } });
        const result = await pnpmVersion({ expected: '10.24.0' }).run(ctx);
        expect(result.ok).toBe(true);
    });
});
