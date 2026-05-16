import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { Check } from '../../types.js';

/** Options for `dockerServicesUp`. */
export interface DockerServicesOptions {
    /**
     * Path to `docker-compose.yml`. Relative paths are resolved against the
     * repo root. Defaults to `'docker-compose.yml'`.
     */
    composeFile?: string;
    /**
     * When true (default), a missing compose file is treated as a passing
     * check with a skip message. When false, it's a failure.
     */
    skipIfMissing?: boolean;
    /** When true, the check attaches an `autoFix` that runs `docker compose up -d`. */
    autoStart?: boolean;
}

interface ComposeService {
    Service: string;
    State: string;
}

const parseComposePs = (raw: string): ComposeService[] => {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
        return JSON.parse(trimmed) as ComposeService[];
    }
    // NDJSON
    const services: ComposeService[] = [];
    for (const line of trimmed.split('\n')) {
        if (!line.trim()) continue;
        try {
            services.push(JSON.parse(line) as ComposeService);
        } catch {
            // ignore malformed line
        }
    }
    return services;
};

/**
 * Check that `docker compose ps` reports every service in the running state.
 * Parses both JSON-array and NDJSON output formats. When `autoStart` is set the
 * returned check exposes an `autoFix` that runs `docker compose up -d`.
 */
export const dockerServicesUp = (options: DockerServicesOptions = {}): Check => {
    const composeFileRel = options.composeFile ?? 'docker-compose.yml';
    const skipIfMissing = options.skipIfMissing ?? true;

    const check: Check = {
        name: 'docker compose services up',
        run: async ctx => {
            const composeFile = isAbsolute(composeFileRel) ? composeFileRel : resolve(ctx.paths.repoRoot, composeFileRel);
            if (!existsSync(composeFile)) {
                return skipIfMissing
                    ? { ok: true, message: `no ${composeFileRel}; skipping` }
                    : { ok: false, message: `${composeFile} is missing` };
            }
            let raw: string;
            try {
                const result = await ctx.shell.run('docker', ['compose', 'ps', '--format', 'json'], { cwd: ctx.paths.repoRoot });
                raw = String(result.stdout);
            } catch (err) {
                return {
                    ok: false,
                    message: `\`docker compose ps\` failed: ${(err as Error).message}`,
                    fixHint: 'Ensure Docker is installed and running.',
                };
            }

            const services = parseComposePs(raw);
            if (services.length === 0) {
                return {
                    ok: false,
                    message: 'no compose services running',
                    fixHint: 'Run `docker compose up -d`.',
                };
            }
            const notRunning = services.filter(s => s.State !== 'running');
            if (notRunning.length > 0) {
                return {
                    ok: false,
                    message: `not running: ${notRunning.map(s => s.Service).join(', ')}`,
                    fixHint: 'Run `docker compose up -d`.',
                };
            }
            return { ok: true, message: `${services.length} service(s) running` };
        },
    };

    if (options.autoStart) {
        check.autoFix = async ctx => {
            const exit = await ctx.shell.runStreaming('docker', ['compose', 'up', '-d'], { cwd: ctx.paths.repoRoot });
            return exit === 0 ? { ok: true, message: 'compose services started' } : { ok: false, message: `compose up exited ${exit}` };
        };
    }

    return check;
};
