import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isInteractive } from '../src/util/tty.js';

describe('isInteractive', () => {
    const originalEnv = { ...process.env };
    const originalStdoutTTY = process.stdout.isTTY;
    const originalStdinTTY = process.stdin.isTTY;

    beforeEach(() => {
        delete process.env['CI'];
        delete process.env['JOHNNY5_NON_INTERACTIVE'];
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutTTY, configurable: true });
        Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinTTY, configurable: true });
    });

    const setTTY = (stdout: boolean, stdin: boolean): void => {
        Object.defineProperty(process.stdout, 'isTTY', { value: stdout, configurable: true });
        Object.defineProperty(process.stdin, 'isTTY', { value: stdin, configurable: true });
    };

    it('returns true when both streams are TTYs', () => {
        setTTY(true, true);
        expect(isInteractive()).toBe(true);
    });

    it('returns false when stdout is not a TTY', () => {
        setTTY(false, true);
        expect(isInteractive()).toBe(false);
    });

    it('returns false when stdin is not a TTY', () => {
        setTTY(true, false);
        expect(isInteractive()).toBe(false);
    });

    it('returns false when CI=true even with TTYs', () => {
        setTTY(true, true);
        process.env['CI'] = 'true';
        expect(isInteractive()).toBe(false);
    });

    it('returns false when CI=1', () => {
        setTTY(true, true);
        process.env['CI'] = '1';
        expect(isInteractive()).toBe(false);
    });

    it('returns false when JOHNNY5_NON_INTERACTIVE=1', () => {
        setTTY(true, true);
        process.env['JOHNNY5_NON_INTERACTIVE'] = '1';
        expect(isInteractive()).toBe(false);
    });
});
