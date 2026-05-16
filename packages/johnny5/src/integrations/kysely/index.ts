import type { Kysely } from 'kysely';
import type { Check } from '../../types.js';

/** Options for `kyselyTableExists`. */
export interface KyselyTableExistsOptions {
    /** Kysely instance to introspect. Typically resolved from the bootstrapped container. */
    db: Kysely<unknown>;
    /** Unqualified table name to look for. */
    table: string;
    /** Optional schema to scope the lookup. When omitted, any schema is accepted. */
    schema?: string;
}

/**
 * Check that a table exists in the database by asking Kysely's introspection
 * API. Useful for surfacing "did you run migrations?" failures at doctor time
 * — e.g. `kyselyTableExists({ db, table: 'relation_tuples' })` for the
 * `@maroonedsoftware/permissions` tuple store, or any other migration-managed
 * table.
 *
 * No `autoFix` — creating tables belongs in a migrations command, not in a
 * doctor pass.
 */
export const kyselyTableExists = (options: KyselyTableExistsOptions): Check => {
    const qualified = options.schema ? `${options.schema}.${options.table}` : options.table;
    return {
        name: `table ${qualified} exists`,
        run: async () => {
            try {
                const tables = await options.db.introspection.getTables({ withInternalKyselyTables: false });
                const match = tables.find(t => t.name === options.table && (options.schema === undefined || t.schema === options.schema));
                if (match) return { ok: true, message: `${qualified} exists` };
                return {
                    ok: false,
                    message: `${qualified} not found`,
                    fixHint: 'Run your database migrations.',
                };
            } catch (err) {
                return { ok: false, message: `introspection failed: ${(err as Error).message}` };
            }
        },
    };
};
