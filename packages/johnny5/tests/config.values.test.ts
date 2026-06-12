import { describe, expect, it } from 'vitest';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { envNumber, readConfigNumber, readConfigString } from '../src/integrations/config.values.js';
import { createMockContext } from './helpers.js';

// These helpers exist because AppConfig coerces missing keys instead of
// throwing: getString returns the literal string 'undefined' and getNumber
// returns NaN. The tests pin the raw-read-and-validate behavior the postgres
// and redis checks rely on for their process.env fallbacks.

const contextWithConfig = (values: Record<string, unknown>) => createMockContext({ config: new AppConfig(values) });

const contextWithThrowingGetter = () => {
    const ctx = createMockContext();
    ctx.config.getAs = ((key: string) => {
        throw new Error(`no ${key}`);
    }) as never;
    return ctx;
};

describe('readConfigString', () => {
    it('returns a non-empty string value', () => {
        expect(readConfigString(contextWithConfig({ KEY: 'value' }), 'KEY')).toBe('value');
    });

    it('returns undefined when the key is absent', () => {
        expect(readConfigString(contextWithConfig({}), 'KEY')).toBeUndefined();
    });

    it('returns undefined for an empty string', () => {
        expect(readConfigString(contextWithConfig({ KEY: '' }), 'KEY')).toBeUndefined();
    });

    it('returns undefined for a non-string value', () => {
        expect(readConfigString(contextWithConfig({ KEY: 6379 }), 'KEY')).toBeUndefined();
    });

    it('returns undefined when the getter throws', () => {
        expect(readConfigString(contextWithThrowingGetter(), 'KEY')).toBeUndefined();
    });
});

describe('readConfigNumber', () => {
    it('returns a numeric value', () => {
        expect(readConfigNumber(contextWithConfig({ KEY: 6379 }), 'KEY')).toBe(6379);
    });

    it('coerces a numeric string', () => {
        expect(readConfigNumber(contextWithConfig({ KEY: '6500' }), 'KEY')).toBe(6500);
    });

    it('returns undefined when the key is absent', () => {
        expect(readConfigNumber(contextWithConfig({}), 'KEY')).toBeUndefined();
    });

    it('returns undefined for an empty string', () => {
        expect(readConfigNumber(contextWithConfig({ KEY: '' }), 'KEY')).toBeUndefined();
    });

    it('returns undefined for a non-numeric string', () => {
        expect(readConfigNumber(contextWithConfig({ KEY: 'not-a-number' }), 'KEY')).toBeUndefined();
    });

    it('returns undefined for a non-finite number', () => {
        expect(readConfigNumber(contextWithConfig({ KEY: Number.NaN }), 'KEY')).toBeUndefined();
    });

    it('returns undefined when the getter throws', () => {
        expect(readConfigNumber(contextWithThrowingGetter(), 'KEY')).toBeUndefined();
    });
});

describe('envNumber', () => {
    it('parses a numeric string', () => {
        expect(envNumber('6500')).toBe(6500);
    });

    it('returns undefined for undefined', () => {
        expect(envNumber(undefined)).toBeUndefined();
    });

    it('returns undefined for an empty string', () => {
        expect(envNumber('')).toBeUndefined();
    });

    it('returns undefined for a non-numeric string', () => {
        expect(envNumber('not-a-number')).toBeUndefined();
    });
});
