import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLogger } from '../src/util/logger.js';

describe('createDefaultLogger', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('writes info to console.log', () => {
        createDefaultLogger().info('hello');
        expect(logSpy).toHaveBeenCalledWith('hello');
    });

    it('colours warn with yellow', () => {
        createDefaultLogger().warn('careful');
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('careful'));
        expect(warnSpy.mock.calls[0]?.[0]).toMatch(/\x1b\[33m/);
    });

    it('colours error with red', () => {
        createDefaultLogger().error('boom');
        expect(errorSpy.mock.calls[0]?.[0]).toMatch(/\x1b\[31m/);
    });

    it('colours success with green', () => {
        createDefaultLogger().success('done');
        expect(logSpy.mock.calls[0]?.[0]).toMatch(/\x1b\[32m/);
    });

    it('suppresses debug output by default', () => {
        createDefaultLogger().debug('shh');
        expect(logSpy).not.toHaveBeenCalled();
    });

    it('emits debug output when verbose is true', () => {
        createDefaultLogger({ verbose: true }).debug('tell me');
        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(logSpy.mock.calls[0]?.[0]).toMatch(/\x1b\[90m/);
        expect(logSpy.mock.calls[0]?.[0]).toContain('tell me');
    });
});
