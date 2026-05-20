import { spawn, type StdioOptions } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';
import { execa, type Options as ExecaOptions, type ResultPromise } from 'execa';
import type { CliLogger } from './logger.js';

/** Execa options re-typed to require a string `cwd` at the call site. */
export interface ShellOptions extends ExecaOptions {
    cwd?: string;
}

/** Options accepted by `Shell.runDetached`. */
export interface RunDetachedOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    /**
     * Absolute path to a log file. Stdout and stderr are appended here.
     * The parent directory is created if missing. When omitted, stdio is ignored.
     */
    logFile?: string;
}

/** Handle returned by `Shell.runDetached` once the child is spawned and detached. */
export interface DetachedHandle {
    pid: number;
    logFile?: string;
}

/** Tiny shell wrapper around execa exposed on `CliContext.shell`. */
export interface Shell {
    /** Run a command, returning the execa result promise. Use this when the caller needs stdout/stderr. */
    run: (command: string, args: string[], options?: ShellOptions) => ResultPromise;
    /** Run a command with inherited stdio, returning the exit code. Failures don't throw — the exit code is returned instead. */
    runStreaming: (command: string, args: string[], options?: ShellOptions) => Promise<number>;
    /**
     * Spawn a command detached from the current process, returning its PID immediately.
     * The child is `unref()`-ed so the CLI can exit while the child keeps running.
     * When `logFile` is supplied, stdout/stderr are appended to it; otherwise stdio is ignored.
     */
    runDetached: (command: string, args: string[], options?: RunDetachedOptions) => DetachedHandle;
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
    runDetached: (command, args, options = {}) => {
        const workingDir = options.cwd ?? cwd;
        let stdio: StdioOptions = 'ignore';
        if (options.logFile) {
            mkdirSync(dirname(options.logFile), { recursive: true });
            const fd = openSync(options.logFile, 'a');
            stdio = ['ignore', fd, fd];
        }
        logger.debug(`$ (detached) ${command} ${args.join(' ')}`);
        const child = spawn(command, args, {
            cwd: workingDir,
            env: options.env ?? process.env,
            detached: true,
            stdio,
        });
        if (child.pid === undefined) {
            throw new Error(`Failed to spawn detached process: ${command}`);
        }
        child.unref();
        return { pid: child.pid, logFile: options.logFile };
    },
});
