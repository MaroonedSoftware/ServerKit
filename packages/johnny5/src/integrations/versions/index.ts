import type { Check } from '../../types.js';

/** Options for `nodeVersion`. */
export interface NodeVersionOptions {
    /** Minimum Node major version required. The check fails when `process.versions.node` is below this. */
    min: number;
}

/** Check that `process.versions.node` is at least `options.min` (compared by major version). */
export const nodeVersion = (options: NodeVersionOptions): Check => ({
    name: `node ≥ ${options.min}`,
    run: async () => {
        const raw = process.versions.node;
        const major = Number(raw.split('.')[0]);
        if (!Number.isFinite(major) || major < options.min) {
            return {
                ok: false,
                message: `running on Node ${raw}; need ≥ ${options.min}`,
                fixHint: `Install Node ${options.min}+ (e.g. \`fnm install ${options.min}\` or \`nvm install ${options.min}\`).`,
            };
        }
        return { ok: true, message: `Node ${raw}` };
    },
});

/** Options for `pnpmVersion`. */
export interface PnpmVersionOptions {
    /**
     * If supplied, the installed pnpm version must match exactly. Otherwise
     * only presence on PATH is checked.
     */
    expected?: string;
}

/**
 * Check that pnpm is on PATH and (optionally) matches a specific version. Fails
 * with a corepack-flavoured fixHint when the binary is missing or mismatched.
 */
export const pnpmVersion = (options: PnpmVersionOptions = {}): Check => ({
    name: 'pnpm version',
    run: async ctx => {
        let installed: string;
        try {
            const result = await ctx.shell.run('pnpm', ['--version']);
            installed = String(result.stdout).trim();
        } catch {
            return {
                ok: false,
                message: 'pnpm not found on PATH',
                fixHint: 'Install pnpm via corepack: `corepack enable && corepack prepare pnpm@latest --activate`.',
            };
        }
        if (options.expected && installed !== options.expected) {
            return {
                ok: false,
                message: `pnpm ${installed}; expected ${options.expected}`,
                fixHint: `Run \`corepack prepare pnpm@${options.expected} --activate\` to match.`,
            };
        }
        return { ok: true, message: `pnpm ${installed}` };
    },
});
