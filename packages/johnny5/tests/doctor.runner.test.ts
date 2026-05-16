import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Check } from '../src/index.js';
import { buildDoctorCommand, runChecks } from '../src/doctor/runner.js';
import { createMockContext } from './helpers.js';

describe('runChecks', () => {
    let writeSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
        writeSpy.mockRestore();
    });

    const passing: Check = {
        name: 'always-ok',
        run: async () => ({ ok: true, message: 'great' }),
    };

    const failing: Check = {
        name: 'always-bad',
        run: async () => ({ ok: false, message: 'nope', fixHint: 'try X' }),
    };

    const throwing: Check = {
        name: 'broken',
        run: async () => {
            throw new Error('kaboom');
        },
    };

    it('returns 0 and reports success when all checks pass', async () => {
        const ctx = createMockContext();
        const exit = await runChecks(ctx, [passing], { fix: false });
        expect(exit).toBe(0);
        expect(ctx.logger.success).toHaveBeenCalledWith('All checks passed.');
    });

    it('returns 1 and reports failure when any check fails', async () => {
        const ctx = createMockContext();
        const exit = await runChecks(ctx, [passing, failing], { fix: false });
        expect(exit).toBe(1);
        expect(ctx.logger.error).toHaveBeenCalledWith('1 check(s) failed.');
    });

    it('renders the fixHint when fix is false', async () => {
        const ctx = createMockContext();
        await runChecks(ctx, [failing], { fix: false });
        const output = writeSpy.mock.calls.map(call => String(call[0])).join('');
        expect(output).toContain('→ try X');
    });

    it('treats an exception inside check.run as a failure with the error message', async () => {
        const ctx = createMockContext();
        const exit = await runChecks(ctx, [throwing], { fix: false });
        expect(exit).toBe(1);
        const output = writeSpy.mock.calls.map(call => String(call[0])).join('');
        expect(output).toContain('threw: kaboom');
    });

    it('invokes autoFix when --fix is set and the check failed', async () => {
        const autoFix = vi.fn(async () => ({ ok: true, message: 'patched' }));
        const ctx = createMockContext();
        const exit = await runChecks(ctx, [{ ...failing, autoFix }], { fix: true });
        expect(autoFix).toHaveBeenCalledTimes(1);
        // A check whose autoFix succeeds isn't counted as failed → exit 0.
        expect(exit).toBe(0);
    });

    it('logs an "Auto-fixed N issue(s)" summary when at least one fix succeeded but others still failed', async () => {
        const fixable: Check = {
            ...failing,
            autoFix: async () => ({ ok: true, message: 'patched' }),
        };
        const unfixable: Check = {
            ...failing,
            name: 'unfixable',
        };
        const ctx = createMockContext();
        await runChecks(ctx, [fixable, unfixable], { fix: true });
        expect(ctx.logger.info).toHaveBeenCalledWith(expect.stringContaining('Auto-fixed 1 issue'));
    });

    it('still counts the failure when autoFix returns ok:false', async () => {
        const autoFix = vi.fn(async () => ({ ok: false, message: 'still broken' }));
        const ctx = createMockContext();
        const exit = await runChecks(ctx, [{ ...failing, autoFix }], { fix: true });
        expect(exit).toBe(1);
    });

    it('still counts the failure when autoFix throws', async () => {
        const autoFix = vi.fn(async () => {
            throw new Error('fix exploded');
        });
        const ctx = createMockContext();
        const exit = await runChecks(ctx, [{ ...failing, autoFix }], { fix: true });
        expect(exit).toBe(1);
        const output = writeSpy.mock.calls.map(call => String(call[0])).join('');
        expect(output).toContain('fix exploded');
    });

    it('skips autoFix when fix flag is false even if defined', async () => {
        const autoFix = vi.fn(async () => ({ ok: true, message: 'patched' }));
        await runChecks(createMockContext(), [{ ...failing, autoFix }], { fix: false });
        expect(autoFix).not.toHaveBeenCalled();
    });
});

describe('buildDoctorCommand', () => {
    let writeSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
        writeSpy.mockRestore();
    });

    it('produces a CommandModule whose run delegates to runChecks', async () => {
        const check: Check = { name: 'noop', run: async () => ({ ok: true, message: 'fine' }) };
        const mod = buildDoctorCommand([check]);
        expect(mod.description).toBe('Run local-dev health checks');
        expect(mod.options?.[0]?.flags).toBe('--fix');

        const ctx = createMockContext();
        const exit = await mod.run({ fix: false }, ctx, []);
        expect(exit).toBe(0);
    });

    it('passes the --fix flag through to runChecks', async () => {
        const autoFix = vi.fn(async () => ({ ok: true, message: 'fixed' }));
        const check: Check = {
            name: 'fixable',
            run: async () => ({ ok: false, message: 'broken' }),
            autoFix,
        };
        const mod = buildDoctorCommand([check]);
        await mod.run({ fix: true }, createMockContext(), []);
        expect(autoFix).toHaveBeenCalled();
    });
});
