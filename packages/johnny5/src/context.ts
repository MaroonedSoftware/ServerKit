import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AppConfigBuilder, AppConfigProviderDotenv, type AppConfig } from '@maroonedsoftware/appconfig';
import type { CliContext, CliPaths } from './types.js';
import type { CliLogger } from './util/logger.js';
import { createDefaultLogger } from './util/logger.js';
import { createShell } from './util/shell.js';
import { isInteractive } from './util/tty.js';

/** Options accepted by `buildContext`. */
export interface BuildContextOptions {
    config?: AppConfig;
    logger?: CliLogger;
    verbose?: boolean;
    repoRoot?: string;
    /**
     * Paths to .env files (absolute, or relative to the resolved repoRoot) to
     * load into process.env before building AppConfig. Missing files are
     * silently skipped. Existing process.env values are not overridden.
     * Defaults to ['.env', 'apps/api/.env'].
     */
    envFiles?: string[];
}

const findRepoRoot = (start: string): string => {
    let dir = start;
    for (let i = 0; i < 12; i++) {
        if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return process.cwd();
};

// Expands `$VAR` and `${VAR}` references against process.env. Matches the
// behaviour of dotenv-expand so .env files authored for dbmate/docker-compose
// (where placeholders are common) still produce usable runtime values.
const expandValue = (value: string): string =>
    value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, braced: string | undefined, bare: string | undefined) => {
        const key = (braced ?? bare) as string;
        return process.env[key] ?? '';
    });

const loadEnvFile = (path: string): void => {
    if (!existsSync(path)) return;
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const rawValue = trimmed.slice(eqIdx + 1).trim();

        // Detect quoting style before unwrapping. Single-quoted values are
        // taken literally; double-quoted and unquoted values get $VAR
        // expansion against the current process.env.
        const singleQuoted = rawValue.startsWith("'") && rawValue.endsWith("'");
        const doubleQuoted = rawValue.startsWith('"') && rawValue.endsWith('"');
        let value = singleQuoted || doubleQuoted ? rawValue.slice(1, -1) : rawValue;
        if (!singleQuoted) value = expandValue(value);

        if (!(key in process.env)) process.env[key] = value;
    }
};

/**
 * Build an AppConfig with only the dotenv provider attached. Callers are
 * expected to have loaded .env files into `process.env` beforehand — see
 * `buildContext` for the default loading sequence.
 */
export const buildDefaultAppConfig = async (): Promise<AppConfig> =>
    new AppConfigBuilder().addProvider(new AppConfigProviderDotenv()).build();

/**
 * Build the `CliContext` handed to every command, check, and plugin hook. Loads
 * `.env` files into `process.env`, resolves the workspace `repoRoot`, and wires
 * up shell, logger, and config.
 */
export const buildContext = async (options: BuildContextOptions = {}): Promise<CliContext> => {
    // Start from cwd so consumers linked from a sibling repo (or installed
    // from npm into node_modules) still resolve to the CONSUMER's workspace
    // root rather than wherever johnny5 itself happens to live.
    const cwd = process.cwd();
    const repoRoot = options.repoRoot ?? findRepoRoot(cwd);
    const paths: CliPaths = { cwd, repoRoot };

    for (const envFile of options.envFiles ?? ['.env', 'apps/api/.env']) {
        const absolute = envFile.startsWith('/') ? envFile : resolve(repoRoot, envFile);
        loadEnvFile(absolute);
    }

    const logger = options.logger ?? createDefaultLogger({ verbose: options.verbose });
    const shell = createShell(repoRoot, logger);
    const config = options.config ?? (await buildDefaultAppConfig());

    return {
        paths,
        logger,
        shell,
        config,
        env: process.env,
        isInteractive,
    };
};
