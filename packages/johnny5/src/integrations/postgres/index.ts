import { readConfigString } from '../config.values.js';
import type { Check } from '../../types.js';

/** Options for `postgresReachable`. */
export interface PostgresReachableOptions {
    /**
     * The AppConfig key whose string value holds the connection string.
     * Defaults to `'DATABASE_URL'`. When the key is absent from the config
     * (or the getter throws), falls back to `process.env[configKey]`.
     */
    configKey?: string;
    /** Direct override — takes precedence over `configKey`. */
    connectionString?: string;
    /** Connection timeout in milliseconds. Defaults to `2000`. */
    timeoutMs?: number;
}

/**
 * Check that Postgres accepts a connection and responds to `select version()`.
 *
 * The connection string is resolved when the check runs (not when it is
 * constructed): an explicit `connectionString` wins, then the config value for
 * `configKey`, then `process.env[configKey]`. Lazily loads `pg` so consumers
 * who don't need the check don't pay the import cost. Returns a failing result
 * with a clear message when `pg` isn't installed.
 */
export const postgresReachable = (options: PostgresReachableOptions = {}): Check => ({
    name: 'postgres reachable',
    run: async ctx => {
        let pg: typeof import('pg');
        try {
            pg = await import('pg');
        } catch {
            return { ok: false, message: '`pg` is not installed; add it as a dependency to use this check' };
        }

        // Resolved here, at check run time, so env files loaded during CLI
        // startup (and the default sourceless AppConfig) are handled.
        const configKey = options.configKey ?? 'DATABASE_URL';
        const url = options.connectionString ?? readConfigString(ctx, configKey) ?? process.env[configKey];
        if (!url) {
            return {
                ok: false,
                message: `${configKey} is not set`,
                fixHint: `Set ${configKey} in your .env.`,
            };
        }

        const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: options.timeoutMs ?? 2000 });
        try {
            await client.connect();
            const result = await client.query<{ version: string }>('select version() as version');
            const version = result.rows[0]?.version ?? 'unknown';
            const short = version.split(' ').slice(0, 2).join(' ');
            return { ok: true, message: short };
        } catch (err) {
            return {
                ok: false,
                message: `connection failed: ${(err as Error).message}`,
                fixHint: 'Start Postgres (`docker compose up -d`) or check the connection string.',
            };
        } finally {
            await client.end().catch(() => undefined);
        }
    },
});
