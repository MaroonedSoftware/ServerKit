import { execa, type Options as ExecaOptions, type ResultPromise } from 'execa';
import type { CliLogger } from './logger.js';

/** Execa options re-typed to require a string `cwd` at the call site. */
export interface ShellOptions extends ExecaOptions {
    cwd?: string;
}

/** Tiny shell wrapper around execa exposed on `CliContext.shell`. */
export interface Shell {
    /** Run a command, returning the execa result promise. Use this when the caller needs stdout/stderr. */
    run: (command: string, args: string[], options?: ShellOptions) => ResultPromise;
    /** Run a command with inherited stdio, returning the exit code. Failures don't throw — the exit code is returned instead. */
    runStreaming: (command: string, args: string[], options?: ShellOptions) => Promise<number>;
}

/** Build a `Shell` bound to `cwd`, logging streaming invocations through `logger.debug`. */
export const createShell = (cwd: string, logger: CliLogger): Shell => ({
    run: (command, args, options) => execa(command, args, { cwd, ...options }),
    runStreaming: async (command, args, options) => {
        logger.debug(`$ ${command} ${args.join(' ')}`);
        const child = execa(command, args, { cwd, stdio: 'inherit', reject: false, ...options });
        const result = await child;
        return result.exitCode ?? 0;
    },
});
