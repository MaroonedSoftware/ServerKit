import net from 'node:net';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { Check } from '../../types.js';

/** Options for `envFile`. */
export interface EnvFileOptions {
    /** Path to the .env file. Relative paths are resolved against the repo root. */
    path: string;
    /** Process env vars that must be set after the file is loaded. */
    required?: string[];
}

/**
 * Check that an `.env` file exists at `options.path` and that every entry in
 * `options.required` is present on `process.env`. Note: this check does not
 * itself load the file — it assumes `buildContext` has already done so.
 */
export const envFile = (options: EnvFileOptions): Check => ({
    name: `${options.path} present`,
    run: async ctx => {
        const absolute = isAbsolute(options.path) ? options.path : resolve(ctx.paths.repoRoot, options.path);
        if (!existsSync(absolute)) {
            return {
                ok: false,
                message: `${absolute} is missing`,
                fixHint: `Create ${options.path} (often from a .env.example).`,
            };
        }
        const missing = (options.required ?? []).filter(v => !process.env[v]);
        if (missing.length > 0) {
            return {
                ok: false,
                message: `present, but missing: ${missing.join(', ')}`,
                fixHint: `Add ${missing.join(', ')} to ${options.path}`,
            };
        }
        return { ok: true, message: 'present' };
    },
});

/** Options for `portsFree`. Each entry is either a bare port number or `{ port, label }`. */
export interface PortsFreeOptions {
    ports: Array<{ port: number; label?: string } | number>;
}

const probePort = (port: number): Promise<boolean> =>
    new Promise(resolveDone => {
        const server = net.createServer();
        server.once('error', () => resolveDone(false));
        server.once('listening', () => {
            server.close(() => resolveDone(true));
        });
        server.listen(port, '127.0.0.1');
    });

/**
 * Check that every port in `options.ports` is free on `127.0.0.1`. Probes by
 * attempting to bind; reports the labels of any port that fails to bind.
 */
export const portsFree = (options: PortsFreeOptions): Check => {
    const specs = options.ports.map(p => (typeof p === 'number' ? { port: p, label: String(p) } : { port: p.port, label: p.label ?? String(p.port) }));
    return {
        name: 'dev ports free',
        run: async () => {
            const occupied: Array<{ port: number; label: string }> = [];
            for (const spec of specs) {
                const free = await probePort(spec.port);
                if (!free) occupied.push(spec);
            }
            if (occupied.length === 0) return { ok: true, message: specs.map(s => `:${s.port}`).join(', ') };
            return {
                ok: false,
                message: `in use: ${occupied.map(s => `${s.label}:${s.port}`).join(', ')}`,
                fixHint: `Stop the process holding these ports (\`lsof -i :${occupied[0]?.port}\`).`,
            };
        },
    };
};
