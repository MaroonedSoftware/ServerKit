import { describe, expect, it, vi } from 'vitest';
import { createMockContext } from './helpers.js';

const CANCEL = Symbol('test-wizard-cancel');

vi.mock('@clack/prompts', () => {
    const log = {
        success: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        step: vi.fn(),
        message: vi.fn(),
    };
    return {
        isCancel: (value: unknown) => value === CANCEL,
        intro: vi.fn(),
        outro: vi.fn(),
        confirm: vi.fn(),
        text: vi.fn(),
        password: vi.fn(),
        select: vi.fn(),
        multiselect: vi.fn(),
        log,
        spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
    };
});

const clackMock = await import('@clack/prompts');
const { wizard } = await import('../src/util/wizard.js');
const { PromptCancelledError } = await import('../src/util/prompts.js');

describe('wizard', () => {
    it('prints intro + success outro and returns 0 when body resolves with void', async () => {
        vi.mocked(clackMock.intro).mockClear();
        vi.mocked(clackMock.outro).mockClear();

        const code = await wizard(createMockContext(), { title: 'go' }, async () => {
            // body does nothing
        });

        expect(code).toBe(0);
        expect(clackMock.intro).toHaveBeenCalledWith('go');
        expect(clackMock.outro).toHaveBeenCalledWith('done');
    });

    it('returns the body\'s numeric exit code on success', async () => {
        const code = await wizard(createMockContext(), { title: 't' }, async () => 42);
        expect(code).toBe(42);
    });

    it('forwards prompt answers through unwrap', async () => {
        vi.mocked(clackMock.confirm).mockResolvedValueOnce(true as never);
        vi.mocked(clackMock.text).mockResolvedValueOnce('hello' as never);

        const captured: { ok: boolean; name: string } = { ok: false, name: '' };
        await wizard(createMockContext(), { title: 't' }, async w => {
            captured.ok = await w.confirm({ message: 'go?' });
            captured.name = await w.text({ message: 'name?' });
        });

        expect(captured.ok).toBe(true);
        expect(captured.name).toBe('hello');
    });

    it('catches user cancel from a prompt and prints the cancel outro', async () => {
        vi.mocked(clackMock.confirm).mockResolvedValueOnce(CANCEL as never);
        vi.mocked(clackMock.outro).mockClear();

        const code = await wizard(createMockContext(), { title: 't' }, async w => {
            await w.confirm({ message: 'go?' });
            return 0;
        });

        expect(code).toBe(1);
        expect(clackMock.outro).toHaveBeenCalledWith('aborted');
    });

    it('treats w.cancel() the same as a user cancel', async () => {
        vi.mocked(clackMock.outro).mockClear();

        const code = await wizard(createMockContext(), { title: 't' }, async w => {
            w.cancel();
        });

        expect(code).toBe(1);
        expect(clackMock.outro).toHaveBeenCalledWith('aborted');
    });

    it('rethrows non-cancel errors from the body', async () => {
        await expect(
            wizard(createMockContext(), { title: 't' }, async () => {
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');
    });

    it('honors successOutro, cancelOutro, and cancelExitCode overrides', async () => {
        vi.mocked(clackMock.outro).mockClear();
        const ok = await wizard(createMockContext(), { title: 't', successOutro: 'all set' }, async () => 0);
        expect(ok).toBe(0);
        expect(clackMock.outro).toHaveBeenLastCalledWith('all set');

        vi.mocked(clackMock.confirm).mockResolvedValueOnce(CANCEL as never);
        const cancelled = await wizard(
            createMockContext(),
            { title: 't', cancelOutro: 'never mind', cancelExitCode: 2 },
            async w => {
                await w.confirm({ message: 'go?' });
            },
        );
        expect(cancelled).toBe(2);
        expect(clackMock.outro).toHaveBeenLastCalledWith('never mind');
    });

    it('lets the body override the success outro via w.outro()', async () => {
        vi.mocked(clackMock.outro).mockClear();
        await wizard(createMockContext(), { title: 't' }, async w => {
            w.outro('custom finish');
        });
        expect(clackMock.outro).toHaveBeenLastCalledWith('custom finish');
    });

    it('throws PromptCancelledError from w.cancel() so consumers can also catch it directly', async () => {
        vi.mocked(clackMock.outro).mockClear();
        const seen: unknown[] = [];

        await wizard(createMockContext(), { title: 't' }, async w => {
            try {
                w.cancel();
            } catch (err) {
                seen.push(err);
                throw err;
            }
        });

        expect(seen[0]).toBeInstanceOf(PromptCancelledError);
    });
});
