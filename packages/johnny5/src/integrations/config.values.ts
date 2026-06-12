import type { CliContext } from '../types.js';

// AppConfig coerces missing keys instead of throwing: `getString` returns the
// literal string 'undefined' (String(undefined)) and `getNumber` returns NaN.
// A try/catch around the getter alone therefore never reaches the env
// fallback — and the default AppConfig built by `buildContext` when the
// consumer passes no config has no sources at all, so EVERY key is missing.
// These helpers read the raw value and accept it only when it is genuinely
// usable, letting checks fall back to process.env and sane defaults.

/** Read a config key as a non-empty string, or `undefined` when the key is absent, empty, non-string, or the getter throws. */
export const readConfigString = (ctx: CliContext, key: string): string | undefined => {
    let value: unknown;
    try {
        value = ctx.config.getAs<unknown>(key);
    } catch {
        return undefined;
    }
    return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/** Read a config key as a finite number (numeric strings are coerced), or `undefined` when absent/unusable or the getter throws. */
export const readConfigNumber = (ctx: CliContext, key: string): number | undefined => {
    let value: unknown;
    try {
        value = ctx.config.getAs<unknown>(key);
    } catch {
        return undefined;
    }
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.length > 0 ? Number(value) : NaN;
    return Number.isFinite(parsed) ? parsed : undefined;
};

/** Parse an env var into a finite number, or `undefined` when unset, empty, or not numeric. */
export const envNumber = (raw: string | undefined): number | undefined => {
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : undefined;
};
