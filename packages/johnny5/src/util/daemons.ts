import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DateTime } from 'luxon';
import type { CliLogger } from './logger.js';
import { johnnyPaths, projectSlug, type JohnnyPaths } from './paths.js';
import type { Shell } from './shell.js';

const APP_NAME = 'johnny5';

/** Options for `Daemons.start`. The daemon name must be unique per project. */
export interface DaemonStartOptions {
    /** Identifier used for the pid/log filenames. Must match `/^[A-Za-z0-9._-]+$/`. */
    name: string;
    command: string;
    args: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    /**
     * When a daemon with this name is already running:
     *   - `'reuse'` (default): leave the existing one alone and return its handle.
     *   - `'restart'`: terminate it first, then start fresh.
     *   - `'error'`: throw.
     */
    onExisting?: 'reuse' | 'restart' | 'error';
}

/** Snapshot of a registered daemon. `running` is checked at read time via `process.kill(pid, 0)`. */
export interface DaemonStatus {
    name: string;
    pid: number;
    running: boolean;
    /** Path to the append-only log file. May not exist yet if the daemon has produced no output. */
    logFile: string;
    /** Path to the on-disk pid record. */
    pidFile: string;
    /** Command line as recorded at start time. */
    command: string;
    args: string[];
    cwd: string;
    /** Wall-clock time the daemon was registered. */
    startedAt: DateTime;
}

/** Project-scoped manager for long-running detached processes. */
export interface Daemons {
    /** Start (or reuse) a daemon by name. Idempotent under `onExisting: 'reuse'`. */
    start: (options: DaemonStartOptions) => DaemonStatus;
    /** Send a signal to the daemon (default SIGTERM) and remove its pid file. Returns `true` if a process was signalled. */
    stop: (name: string, options?: { signal?: NodeJS.Signals }) => boolean;
    /** Read the recorded status for `name`, or `undefined` if no pid file exists. */
    status: (name: string) => DaemonStatus | undefined;
    /** List every daemon recorded for the current project. */
    list: () => DaemonStatus[];
    /** Absolute path to the daemon's log file (whether or not the daemon has been started). */
    logFile: (name: string) => string;
    /** Absolute path to the daemon's pid file. */
    pidFile: (name: string) => string;
}

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

interface PidRecord {
    pid: number;
    command: string;
    args: string[];
    cwd: string;
    startedAt: string;
}

const isAlive = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err) {
        // ESRCH = no such process. EPERM = process exists but we lack permission to signal it (still alive).
        return (err as NodeJS.ErrnoException).code === 'EPERM';
    }
};

const readPidRecord = (path: string): PidRecord | undefined => {
    if (!existsSync(path)) return undefined;
    try {
        const raw = readFileSync(path, 'utf-8');
        const parsed = JSON.parse(raw) as PidRecord;
        if (typeof parsed.pid !== 'number') return undefined;
        return parsed;
    } catch {
        return undefined;
    }
};

const toStatus = (name: string, record: PidRecord, pidFile: string, logFile: string): DaemonStatus => ({
    name,
    pid: record.pid,
    running: isAlive(record.pid),
    logFile,
    pidFile,
    command: record.command,
    args: record.args,
    cwd: record.cwd,
    startedAt: DateTime.fromISO(record.startedAt),
});

/**
 * Build a `Daemons` manager scoped to the given project root. PID files live
 * under the OS runtime dir keyed by project slug; log files live under the OS
 * log dir keyed by the same slug. See `johnnyPaths` and `projectSlug` for
 * exact locations on each platform. Pass `paths` to redirect runtime/log dirs
 * (useful for tests that need an isolated filesystem location).
 */
export const createDaemons = (projectRoot: string, shell: Shell, logger: CliLogger, paths: JohnnyPaths = johnnyPaths(APP_NAME)): Daemons => {
    const slug = projectSlug(projectRoot);
    const pidDir = resolve(paths.runtime, slug);
    const logDir = resolve(paths.log, slug);

    const pidFile = (name: string): string => {
        if (!NAME_PATTERN.test(name)) {
            throw new Error(`Invalid daemon name '${name}'. Allowed characters: A-Z a-z 0-9 . _ -`);
        }
        return resolve(pidDir, `${name}.pid`);
    };
    const logFile = (name: string): string => {
        if (!NAME_PATTERN.test(name)) {
            throw new Error(`Invalid daemon name '${name}'. Allowed characters: A-Z a-z 0-9 . _ -`);
        }
        return resolve(logDir, `${name}.log`);
    };

    const status = (name: string): DaemonStatus | undefined => {
        const path = pidFile(name);
        const record = readPidRecord(path);
        if (!record) return undefined;
        return toStatus(name, record, path, logFile(name));
    };

    const stop = (name: string, options: { signal?: NodeJS.Signals } = {}): boolean => {
        const current = status(name);
        if (!current) return false;
        let signalled = false;
        if (current.running) {
            try {
                process.kill(current.pid, options.signal ?? 'SIGTERM');
                signalled = true;
            } catch (err) {
                if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err;
            }
        }
        rmSync(current.pidFile, { force: true });
        logger.debug(`daemon '${name}' stopped (pid ${current.pid})`);
        return signalled;
    };

    const start = (options: DaemonStartOptions): DaemonStatus => {
        const existing = status(options.name);
        if (existing?.running) {
            const policy = options.onExisting ?? 'reuse';
            if (policy === 'reuse') return existing;
            if (policy === 'error') {
                throw new Error(`Daemon '${options.name}' is already running (pid ${existing.pid}).`);
            }
            stop(options.name);
        } else if (existing) {
            // Stale pid file from a crashed previous run.
            rmSync(existing.pidFile, { force: true });
        }

        mkdirSync(pidDir, { recursive: true });
        mkdirSync(logDir, { recursive: true });
        const path = pidFile(options.name);
        const log = logFile(options.name);
        const handle = shell.runDetached(options.command, options.args, {
            cwd: options.cwd,
            env: options.env,
            logFile: log,
        });
        const record: PidRecord = {
            pid: handle.pid,
            command: options.command,
            args: options.args,
            cwd: options.cwd ?? projectRoot,
            startedAt: DateTime.utc().toISO(),
        };
        writeFileSync(path, JSON.stringify(record, null, 2));
        logger.debug(`daemon '${options.name}' started (pid ${handle.pid}, log ${log})`);
        return toStatus(options.name, record, path, log);
    };

    const list = (): DaemonStatus[] => {
        if (!existsSync(pidDir)) return [];
        const results: DaemonStatus[] = [];
        for (const entry of readdirSync(pidDir)) {
            if (!entry.endsWith('.pid')) continue;
            const name = entry.slice(0, -'.pid'.length);
            const snapshot = status(name);
            if (snapshot) results.push(snapshot);
        }
        return results;
    };

    return { start, stop, status, list, logFile, pidFile };
};
