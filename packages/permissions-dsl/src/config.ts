import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';

/**
 * Resolved `permissions.config.json` — all directory paths are absolute after
 * {@link loadConfig} processes the raw JSON.
 */
export interface PermissionsConfig {
    /** Directory all relative paths resolve against. Defaults to the config file's directory. */
    rootDir: string;
    /** Globs of `.perm` files to compile. */
    patterns: string[];
    /** Run prettier over generated TS. */
    prettier: boolean;
    /** Optional override for the import specifier used in generated code. */
    permissionsImport?: string;
    output: {
        /** Directory all output paths resolve against. Defaults to `rootDir`. */
        baseDir: string;
        /** Output template for per-namespace files. `{filename}` substituted with namespace name. */
        namespace: string;
        /** Output path for the aggregate `model` file. */
        model: string;
    };
}

interface RawConfig {
    rootDir?: string;
    patterns?: string[];
    prettier?: boolean;
    permissionsImport?: string;
    output?: {
        baseDir?: string;
        namespace?: string;
        model?: string;
    };
}

const expandHome = (p: string): string => (p.startsWith('~') ? p.replace(/^~/, homedir()) : p);

const resolveDir = (configDir: string, p: string | undefined, fallback: string): string => {
    if (p === undefined) return fallback;
    const expanded = expandHome(p);
    return isAbsolute(expanded) ? expanded : resolve(configDir, expanded);
};

/**
 * Load and validate a `permissions.config.json` file. Resolves all relative
 * paths (`rootDir`, `output.baseDir`) against the config file's directory,
 * expands a leading `~` in any path, and returns both the normalized config
 * and its absolute path.
 *
 * @throws {Error} if the file is missing, `patterns` is empty, or required
 *   `output.namespace` / `output.model` keys are absent. Also when
 *   `output.namespace` lacks the `{filename}` placeholder.
 */
export const loadConfig = async (configPath: string): Promise<{ config: PermissionsConfig; configPath: string }> => {
    const abs = resolve(configPath);
    if (!existsSync(abs)) throw new Error(`config file not found: ${abs}`);
    const raw = JSON.parse(await readFile(abs, 'utf8')) as RawConfig;
    const configDir = dirname(abs);
    const rootDir = resolveDir(configDir, raw.rootDir, configDir);
    const patterns = raw.patterns ?? [];
    if (patterns.length === 0) throw new Error(`config ${abs}: 'patterns' must list at least one glob`);
    const output = raw.output ?? {};
    if (!output.namespace) throw new Error(`config ${abs}: 'output.namespace' is required`);
    if (!output.model) throw new Error(`config ${abs}: 'output.model' is required`);
    if (!output.namespace.includes('{filename}')) {
        throw new Error(`config ${abs}: 'output.namespace' must contain {filename} placeholder`);
    }
    const baseDir = resolveDir(rootDir, output.baseDir, rootDir);
    const config: PermissionsConfig = {
        rootDir,
        patterns,
        prettier: raw.prettier ?? false,
        permissionsImport: raw.permissionsImport,
        output: {
            baseDir,
            namespace: output.namespace,
            model: output.model,
        },
    };
    return { config, configPath: abs };
};

/**
 * Walk up from `cwd` looking for a `permissions.config.json`. Returns the
 * absolute path of the first match, or `undefined` if no ancestor directory
 * contains one. Used by the CLI when invoked without an explicit `--config`.
 */
export const findConfig = (cwd: string): string | undefined => {
    let dir = resolve(cwd);
    // Walk up looking for permissions.config.json
    while (true) {
        const candidate = resolve(dir, 'permissions.config.json');
        if (existsSync(candidate)) return candidate;
        const parent = dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
};
