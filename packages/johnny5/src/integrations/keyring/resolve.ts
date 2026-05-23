import type { CliContext } from '../../types.js';
import { prompts, unwrap } from '../../util/prompts.js';
import type { KeyringEntry } from './entry.js';

/** Policy controlling whether `resolveSecret` persists a freshly-prompted value into the supplied keyring. */
export type PromptStorePolicy = 'ask' | 'always' | 'never';

/** Options for `resolveSecret`. */
export interface ResolveSecretOptions {
    /** Explicit value (e.g. from a `--api-key` flag). Wins over everything else and is never persisted. */
    override?: string;
    /** Process env var names checked in order. The first non-empty value wins. */
    envKeys?: string[];
    /** Keyring entry consulted after env. Omit to skip keyring entirely. */
    keyring?: KeyringEntry;
    /**
     * Interactive prompt invoked when nothing else resolved. Receives the `CliContext`
     * and returns the secret, or `undefined` to abort. Skipping `prompt` makes
     * `resolveSecret` return `null` when no source produced a value.
     */
    prompt?: (ctx: CliContext) => Promise<string | undefined>;
    /**
     * After `prompt` succeeds, whether to persist the value into `keyring`:
     * - `'ask'` (default): confirm with the user before writing.
     * - `'always'`: persist without asking.
     * - `'never'`: never persist.
     *
     * Ignored when `keyring` is omitted.
     */
    promptStore?: PromptStorePolicy;
    /** Used in the confirm message when `promptStore` is `'ask'`. Defaults to `'credential'`. */
    label?: string;
}

/**
 * Resolve a secret value by walking a fixed chain: `override` → first non-empty
 * `envKeys` entry → `keyring.read()` → `prompt(ctx)`. When `prompt` produces a
 * value and a `keyring` is supplied, the value is optionally persisted according
 * to `promptStore`.
 *
 * Returns `null` when every step yields nothing (or `prompt` returned
 * `undefined`). Never calls `process.exit` — callers own the "missing
 * credential" policy.
 */
export const resolveSecret = async (ctx: CliContext, options: ResolveSecretOptions): Promise<string | null> => {
    if (options.override && options.override.length > 0) return options.override;

    for (const key of options.envKeys ?? []) {
        const value = ctx.env[key] ?? process.env[key];
        if (value && value.length > 0) return value;
    }

    if (options.keyring) {
        const fromKeyring = await options.keyring.read();
        if (fromKeyring && fromKeyring.length > 0) return fromKeyring;
    }

    if (!options.prompt) return null;
    const prompted = await options.prompt(ctx);
    if (prompted === undefined || prompted.length === 0) return null;

    if (options.keyring) {
        const policy: PromptStorePolicy = options.promptStore ?? 'ask';
        const shouldStore =
            policy === 'always'
                ? true
                : policy === 'never'
                  ? false
                  : await askToPersist(options.label ?? 'credential');
        if (shouldStore) await options.keyring.write(prompted);
    }

    return prompted;
};

const askToPersist = async (label: string): Promise<boolean> => {
    const answer = unwrap(await prompts.confirm({ message: `Save ${label} to system keyring for future runs?`, initialValue: true }));
    return answer === true;
};
