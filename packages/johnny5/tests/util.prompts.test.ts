import { describe, expect, it, vi } from 'vitest';

// Mock @clack/prompts BEFORE importing util/prompts so the namespace import in
// prompts.ts binds to our mock. The mock exposes an `isCancel` that returns
// true for a sentinel symbol of our own choosing.
const CANCEL = Symbol('test-cancel-sentinel');
vi.mock('@clack/prompts', () => ({
    isCancel: (value: unknown) => value === CANCEL,
}));

const { unwrap, PromptCancelledError, prompts } = await import('../src/util/prompts.js');

describe('unwrap', () => {
    it('returns the value unchanged when not cancelled', () => {
        expect(unwrap('answer')).toBe('answer');
        expect(unwrap(42)).toBe(42);
        expect(unwrap({ ok: true })).toEqual({ ok: true });
    });

    it('throws PromptCancelledError when clack reports cancellation', () => {
        expect(() => unwrap(CANCEL)).toThrow(PromptCancelledError);
    });

    it('re-exports the clack namespace as `prompts`', () => {
        expect(typeof prompts.isCancel).toBe('function');
    });

    it('PromptCancelledError carries the expected name and message', () => {
        const err = new PromptCancelledError();
        expect(err.name).toBe('PromptCancelledError');
        expect(err.message).toBe('prompt cancelled');
        expect(err).toBeInstanceOf(Error);
    });
});
