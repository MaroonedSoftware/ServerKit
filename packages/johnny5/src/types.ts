import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { CliLogger } from './util/logger.js';
import type { Shell } from './util/shell.js';

/** Value-coercion hint for an option declared on a `CommandModule`. */
export type OptionType = 'string' | 'number' | 'boolean';

/** Declarative description of a single CLI option (flag). */
export interface OptionSpec {
    /** Commander-style flag string, e.g. `'--name <name>'` or `'-n, --name <name>'`. */
    flags: string;
    description: string;
    type?: OptionType;
    default?: string | number | boolean;
    required?: boolean;
    /** Process env var to read the value from when the flag is not supplied on the CLI. */
    envVar?: string;
}

/** Declarative description of a single positional argument. */
export interface ArgSpec {
    name: string;
    description: string;
    required?: boolean;
    variadic?: boolean;
}

/**
 * A single CLI command unit. `defineCommand` is the recommended way to create one
 * so TypeScript can infer `Opts` from the literal.
 */
export interface CommandModule<Opts = Record<string, unknown>> {
    name?: string;
    description: string;
    options?: OptionSpec[];
    args?: ArgSpec[];
    /** Optional hook that runs *after* CLI parsing but *before* `run`, only when stdin/stdout are TTYs. Lets a command fill in missing options interactively. */
    interactive?: (ctx: CliContext, partial: Partial<Opts>) => Promise<Opts>;
    /** Returning a non-zero number triggers `process.exit(code)`. `void` / `0` means success. */
    run: (opts: Opts, ctx: CliContext, args: string[]) => Promise<number | void>;
    /** When true, unknown options and excess positional args are forwarded to `run` verbatim instead of triggering commander errors. */
    passthrough?: boolean;
}

/** A `CommandModule` plus the path under which it should appear in the CLI tree. */
export interface CommandRegistration {
    path: string[];
    module: CommandModule;
}

/** A `CommandRegistration` tagged with where it came from — used by the registrar to detect collisions and produce useful error messages. */
export interface DiscoveredCommand extends CommandRegistration {
    source: 'core' | 'plugin';
    sourceName?: string;
}

/** Shape that a workspace plugin's commands file must default-export to be picked up by `loadWorkspacePlugins`. */
export interface PluginManifest {
    name: string;
    commands: CommandRegistration[];
}

/** Outcome of a single doctor check. `fixHint` is rendered when `--fix` is not in play. */
export interface CheckResult {
    ok: boolean;
    message: string;
    fixHint?: string;
}

/**
 * A single doctor check. `run` must always resolve — throws are caught by the
 * runner and rendered as failures. When `autoFix` is supplied and the user passes
 * `--fix`, the runner invokes it for every failing run.
 */
export interface Check {
    name: string;
    run: (ctx: CliContext) => Promise<CheckResult>;
    autoFix?: (ctx: CliContext) => Promise<CheckResult>;
}

/** Filesystem anchors handed to commands. `repoRoot` is the consumer's workspace, not where johnny5 lives. */
export interface CliPaths {
    cwd: string;
    repoRoot: string;
}

/** Per-invocation context handed to every command, check, and plugin hook. */
export interface CliContext {
    paths: CliPaths;
    logger: CliLogger;
    shell: Shell;
    config: AppConfig;
    isInteractive: () => boolean;
    env: NodeJS.ProcessEnv;
}
