import { KyselyPlugin, CamelCasePlugin } from 'kysely';
import { NullToUndefinedPlugin } from './plugins/null.to.undefined.plugin.js';

/**
 * The recommended default Kysely plugin set for ServerKit applications.
 *
 * Includes:
 * - **`CamelCasePlugin`** — Automatically translates snake_case database column
 *   names to camelCase in TypeScript, so `created_at` becomes `createdAt`.
 * - **`NullToUndefinedPlugin`** — Replaces `null` values in query results with
 *   `undefined`, aligning database output with TypeScript's preferred absence type.
 *
 * Pass this array to the `plugins` option when constructing a `Kysely` instance:
 *
 * @example
 * ```typescript
 * import { Kysely, PostgresDialect } from 'kysely';
 * import { KyselyDefaultPlugins, KyselyPool } from '@maroonedsoftware/kysely';
 *
 * const db = new Kysely<Database>({
 *   dialect: new PostgresDialect({ pool }),
 *   plugins: KyselyDefaultPlugins,
 * });
 * ```
 */
export const KyselyDefaultPlugins: KyselyPlugin[] = [new CamelCasePlugin(), new NullToUndefinedPlugin()] as const;
