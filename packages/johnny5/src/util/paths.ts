import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';

/** Per-app filesystem locations following each OS's native conventions. */
export interface JohnnyPaths {
    /** Append-only daemon/process logs. macOS: `~/Library/Logs/<app>`; Linux: `$XDG_STATE_HOME/<app>`; Windows: `%LOCALAPPDATA%\<app>\Log`. */
    log: string;
    /** Runtime ephemera (pid files, sockets). macOS: `$TMPDIR/<app>`; Linux: `$XDG_RUNTIME_DIR/<app>` (falls back to `/tmp/<app>-<uid>`); Windows: `%LOCALAPPDATA%\<app>\Temp`. */
    runtime: string;
    /** Cross-invocation cache. macOS: `~/Library/Caches/<app>`; Linux: `$XDG_CACHE_HOME/<app>`; Windows: `%LOCALAPPDATA%\<app>\Cache`. */
    cache: string;
}

const env = (key: string): string | undefined => {
    const value = process.env[key];
    return value && value.length > 0 ? value : undefined;
};

/**
 * Resolve OS-standard user-level filesystem locations for an app named `app`.
 * `app` should be a stable, lowercase, no-spaces identifier (e.g. `'johnny5'`).
 */
export const johnnyPaths = (app: string): JohnnyPaths => {
    const platform = process.platform;
    if (platform === 'darwin') {
        const home = homedir();
        return {
            log: resolve(home, 'Library/Logs', app),
            runtime: resolve(tmpdir(), app),
            cache: resolve(home, 'Library/Caches', app),
        };
    }
    if (platform === 'win32') {
        const base = env('LOCALAPPDATA') ?? resolve(homedir(), 'AppData/Local');
        return {
            log: resolve(base, app, 'Log'),
            runtime: resolve(base, app, 'Temp'),
            cache: resolve(base, app, 'Cache'),
        };
    }
    // POSIX / Linux: follow XDG Base Directory spec.
    const home = homedir();
    const state = env('XDG_STATE_HOME') ?? resolve(home, '.local/state');
    const cache = env('XDG_CACHE_HOME') ?? resolve(home, '.cache');
    // $XDG_RUNTIME_DIR is only set inside a user session. Fall back to a per-uid
    // /tmp directory so the same path resolves across reboots within a session.
    const runtimeBase = env('XDG_RUNTIME_DIR') ?? resolve(tmpdir(), `${app}-${process.getuid?.() ?? 0}`);
    const runtime = env('XDG_RUNTIME_DIR') ? resolve(runtimeBase, app) : runtimeBase;
    return {
        log: resolve(state, app),
        runtime,
        cache: resolve(cache, app),
    };
};

/**
 * Build a stable, human-readable, collision-free slug for a project root path.
 * Combines the directory basename with a short hash of the absolute path so
 * two checkouts of the same repo at different locations get distinct slugs
 * while remaining easy to identify in `ls` output.
 *
 * Example: `/Users/me/code/my_app` → `my_app-a3f1c9b2`.
 */
export const projectSlug = (projectRoot: string): string => {
    const absolute = resolve(projectRoot);
    const hash = createHash('sha256').update(absolute).digest('hex').slice(0, 8);
    const name = basename(absolute).replace(/[^A-Za-z0-9._-]/g, '_') || 'project';
    return `${name}-${hash}`;
};
