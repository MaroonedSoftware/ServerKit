import type { CliContext } from '../../types.js';

type KeyringModule = typeof import('@napi-rs/keyring');

/** Identifies a single secret slot in the OS keyring. */
export interface KeyringEntryOptions {
    /** Service identifier (e.g. `'my-cli'`). Usually a stable per-app constant. */
    service: string;
    /** Account name under the service (e.g. `'api.key'`). */
    account: string;
}

/**
 * A single keyring slot. All operations are safe — they never throw to the
 * caller. Failures (missing peer dep, keyring unavailable, OS denied access)
 * are logged once via `ctx.logger.warn` and surfaced as `null` / `false`.
 */
export interface KeyringEntry {
    /** Returns the stored password, or `null` if missing or on any error. */
    read: () => Promise<string | null>;
    /** Stores `value`. Returns `true` on success, `false` on any error. */
    write: (value: string) => Promise<boolean>;
    /** Removes the entry. Returns `true` if something was removed. */
    delete: () => Promise<boolean>;
}

let cachedModule: KeyringModule | null | undefined;
let missingWarned = false;

const loadKeyring = async (ctx: CliContext): Promise<KeyringModule | null> => {
    if (cachedModule !== undefined) return cachedModule;
    try {
        cachedModule = await import('@napi-rs/keyring');
    } catch {
        cachedModule = null;
        if (!missingWarned) {
            missingWarned = true;
            ctx.logger.warn('system keyring is unavailable (@napi-rs/keyring is not installed).');
        }
    }
    return cachedModule;
};

/**
 * Build a `KeyringEntry` backed by `@napi-rs/keyring`. The native module is
 * loaded lazily on first use; when it isn't installed, the returned entry
 * degrades gracefully (`read` → `null`, `write` → `false`, `delete` → `false`)
 * after logging a one-shot warning.
 *
 * Intended for use under the `@maroonedsoftware/johnny5/keyring` subpath, so
 * consumers that don't need keyring access never resolve the peer dependency.
 */
export const keyringEntry = (ctx: CliContext, options: KeyringEntryOptions): KeyringEntry => {
    return {
        read: async () => {
            const mod = await loadKeyring(ctx);
            if (!mod) return null;
            try {
                return new mod.Entry(options.service, options.account).getPassword();
            } catch (err) {
                ctx.logger.warn(`system keyring read failed (${(err as Error).message}).`);
                return null;
            }
        },
        write: async value => {
            const mod = await loadKeyring(ctx);
            if (!mod) return false;
            try {
                new mod.Entry(options.service, options.account).setPassword(value);
                return true;
            } catch (err) {
                ctx.logger.warn(`could not persist credential to system keyring (${(err as Error).message}).`);
                return false;
            }
        },
        delete: async () => {
            const mod = await loadKeyring(ctx);
            if (!mod) return false;
            try {
                return new mod.Entry(options.service, options.account).deletePassword();
            } catch {
                return false;
            }
        },
    };
};

/** @internal — exported for tests. Resets the lazy-load cache between cases. */
export const __resetKeyringCache = (): void => {
    cachedModule = undefined;
    missingWarned = false;
};
