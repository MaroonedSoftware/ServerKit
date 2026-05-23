import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockContext } from './helpers.js';
import type { KeyringEntry } from '../src/integrations/keyring/entry.js';

vi.mock('@clack/prompts', () => ({
    isCancel: () => false,
    confirm: vi.fn(),
}));

const clackMock = await import('@clack/prompts');
const { resolveSecret } = await import('../src/integrations/keyring/resolve.js');

const fakeKeyring = (initial: string | null = null): KeyringEntry & { writes: string[] } => {
    let stored = initial;
    const writes: string[] = [];
    return {
        read: vi.fn(async () => stored),
        write: vi.fn(async (value: string) => {
            stored = value;
            writes.push(value);
            return true;
        }),
        delete: vi.fn(async () => {
            stored = null;
            return true;
        }),
        get writes() {
            return writes;
        },
    } as KeyringEntry & { writes: string[] };
};

describe('resolveSecret', () => {
    const originalEnv = { ...process.env };
    beforeEach(() => {
        for (const k of Object.keys(process.env)) if (!(k in originalEnv)) delete process.env[k];
        for (const [k, v] of Object.entries(originalEnv)) process.env[k] = v;
        vi.mocked(clackMock.confirm).mockReset();
    });

    it('returns override and never persists it', async () => {
        const ring = fakeKeyring();
        const result = await resolveSecret(createMockContext(), {
            override: 'cli-flag',
            envKeys: ['FOO'],
            keyring: ring,
            prompt: async () => 'prompted',
        });
        expect(result).toBe('cli-flag');
        expect(ring.write).not.toHaveBeenCalled();
    });

    it('checks envKeys in order, taking the first non-empty value', async () => {
        process.env['FIRST'] = '';
        process.env['SECOND'] = 'value-from-env';
        const result = await resolveSecret(createMockContext(), { envKeys: ['FIRST', 'SECOND', 'THIRD'] });
        expect(result).toBe('value-from-env');
    });

    it('prefers ctx.env entries when present (lets callers inject a sandboxed env)', async () => {
        process.env['SHARED'] = 'process-value';
        const result = await resolveSecret(createMockContext({ env: { SHARED: 'ctx-value' } }), { envKeys: ['SHARED'] });
        expect(result).toBe('ctx-value');
    });

    it('reads from keyring after env yields nothing and short-circuits before prompt', async () => {
        const promptFn = vi.fn(async () => 'should-not-run');
        const result = await resolveSecret(createMockContext(), {
            envKeys: ['NEVER_SET_XYZ'],
            keyring: fakeKeyring('ring-value'),
            prompt: promptFn,
        });
        expect(result).toBe('ring-value');
        expect(promptFn).not.toHaveBeenCalled();
    });

    it('persists prompted value when promptStore is "always"', async () => {
        const ring = fakeKeyring();
        const result = await resolveSecret(createMockContext(), {
            keyring: ring,
            prompt: async () => 'new-secret',
            promptStore: 'always',
        });
        expect(result).toBe('new-secret');
        expect(ring.write).toHaveBeenCalledWith('new-secret');
    });

    it('does not persist when promptStore is "never"', async () => {
        const ring = fakeKeyring();
        const result = await resolveSecret(createMockContext(), {
            keyring: ring,
            prompt: async () => 'new-secret',
            promptStore: 'never',
        });
        expect(result).toBe('new-secret');
        expect(ring.write).not.toHaveBeenCalled();
    });

    it('asks via prompts.confirm when promptStore is "ask" (default) and persists on yes', async () => {
        vi.mocked(clackMock.confirm).mockResolvedValueOnce(true as never);
        const ring = fakeKeyring();
        const result = await resolveSecret(createMockContext(), {
            keyring: ring,
            prompt: async () => 'new-secret',
            label: 'API key',
        });
        expect(result).toBe('new-secret');
        expect(ring.write).toHaveBeenCalledWith('new-secret');
        expect(vi.mocked(clackMock.confirm).mock.calls[0]?.[0]?.message).toContain('API key');
    });

    it('does not persist when ask confirm returns false', async () => {
        vi.mocked(clackMock.confirm).mockResolvedValueOnce(false as never);
        const ring = fakeKeyring();
        const result = await resolveSecret(createMockContext(), {
            keyring: ring,
            prompt: async () => 'new-secret',
        });
        expect(result).toBe('new-secret');
        expect(ring.write).not.toHaveBeenCalled();
    });

    it('returns null when no source produced a value and no prompt is configured', async () => {
        const result = await resolveSecret(createMockContext(), { envKeys: ['NOT_SET_AT_ALL'] });
        expect(result).toBeNull();
    });

    it('returns null when prompt returns undefined', async () => {
        const result = await resolveSecret(createMockContext(), { prompt: async () => undefined });
        expect(result).toBeNull();
    });

    it('skips empty override and falls through to env', async () => {
        process.env['THE_KEY'] = 'env-value';
        const result = await resolveSecret(createMockContext(), { override: '', envKeys: ['THE_KEY'] });
        expect(result).toBe('env-value');
    });
});
