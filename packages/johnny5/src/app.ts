import { Command } from 'commander';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Check, CliContext, CommandModule, CommandRegistration, DiscoveredCommand } from './types.js';
import { registerCommands } from './commander/register.js';
import { buildContext } from './context.js';
import { buildDoctorCommand } from './doctor/runner.js';
import { loadWorkspacePlugins, type WorkspacePluginOptions } from './plugin/workspace.loader.js';
import type { CliLogger } from './util/logger.js';

// Opaque ServerKit module shape — the concrete `ServerKitModule` type lives in
// `@maroonedsoftware/koa`. Importing it here would force every johnny5 consumer
// to pull koa as a hard dep even when not using ServerKit. The serverkit
// integration is responsible for the actual setup() / shutdown() calls.
interface ServerKitModuleLike<ConfigT> {
    name?: string;
    setup?: (registry: unknown, config: ConfigT) => Promise<void>;
    start?: (container: unknown) => Promise<void>;
    shutdown?: (container: unknown) => Promise<void>;
}

/** Options accepted by `createCliApp`. */
export interface CliAppOptions<ConfigT extends AppConfig = AppConfig> {
    name: string;
    description: string;
    version: string;
    commands: CommandRegistration[];
    checks?: Check[];
    config?: ConfigT | (() => Promise<ConfigT>);
    logger?: CliLogger;
    // ServerKit modules to bootstrap lazily for commands written with
    // `requireContainer`. Setting this enables the @maroonedsoftware/johnny5/serverkit
    // integration — make sure that subpath is imported once for its side effect
    // of installing the bootstrap hook (or call configureServerKitModules
    // manually).
    modules?: ServerKitModuleLike<ConfigT>[];
    plugins?: {
        workspace?: Omit<WorkspacePluginOptions, 'repoRoot'> & { repoRoot?: string };
    };
    // Path of the built-in doctor command. Defaults to ['doctor']. Set to
    // null explicitly when supplying your own doctor command.
    doctorCommandPath?: string[] | null;
}

/** The runnable CLI returned by `createCliApp`. */
export interface CliApp {
    /** Parse `argv` (defaults to `process.argv`) and resolve with a process exit code. */
    run: (argv?: string[]) => Promise<number>;
}

/**
 * Identity helper that exists purely to give TypeScript a place to infer the
 * `Opts` generic from the literal passed in. Equivalent to writing the type
 * annotation manually.
 */
export const defineCommand = <Opts = Record<string, unknown>>(mod: CommandModule<Opts>): CommandModule<Opts> => mod;

/**
 * Build a CLI from a list of `CommandModule` registrations. Auto-registers a
 * `doctor` subcommand when `checks` is non-empty, discovers workspace plugins
 * when `plugins.workspace` is configured, and wires up the ServerKit
 * integration when `modules` is supplied.
 */
export const createCliApp = async <ConfigT extends AppConfig = AppConfig>(options: CliAppOptions<ConfigT>): Promise<CliApp> => {
    const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');
    const resolvedConfig = typeof options.config === 'function' ? await options.config() : options.config;
    const ctx = await buildContext({
        config: resolvedConfig,
        logger: options.logger,
        verbose,
    });

    if (options.modules && options.modules.length > 0) {
        const { configureServerKitModules } = (await import('./integrations/serverkit/index.js')) as {
            configureServerKitModules: (ctx: CliContext, modules: unknown[]) => void;
        };
        configureServerKitModules(ctx, options.modules);
    }

    const program = new Command()
        .name(options.name)
        .description(options.description)
        .version(options.version)
        .option('-v, --verbose', 'Enable verbose logging', false);

    const discovered: DiscoveredCommand[] = options.commands.map(c => ({ ...c, source: 'core' as const }));

    if (options.checks && options.checks.length > 0 && options.doctorCommandPath !== null) {
        const doctorPath = options.doctorCommandPath ?? ['doctor'];
        const alreadyDefined = discovered.some(c => c.path.join(' ') === doctorPath.join(' '));
        if (!alreadyDefined) {
            discovered.push({
                path: doctorPath,
                source: 'core',
                module: buildDoctorCommand(options.checks),
            });
        }
    }

    if (options.plugins?.workspace) {
        const workspaceOpts: WorkspacePluginOptions = {
            ...options.plugins.workspace,
            repoRoot: options.plugins.workspace.repoRoot ?? ctx.paths.repoRoot,
        };
        const plugins = await loadWorkspacePlugins(ctx, workspaceOpts);
        discovered.push(...plugins);
    }

    registerCommands(program, discovered, ctx);

    return {
        run: async (argv = process.argv) => {
            try {
                await program.parseAsync(argv);
                return 0;
            } catch (err) {
                ctx.logger.error((err as Error).message);
                return 1;
            }
        },
    };
};
