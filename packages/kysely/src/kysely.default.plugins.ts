import { KyselyPlugin, CamelCasePlugin } from 'kysely';
import { NullToUndefinedPlugin } from './plugins/null.to.undefined.plugin.js';
import { DateTimeParameterPlugin } from './plugins/datetime.parameter.plugin.js';

/**
 * The recommended default Kysely plugin set for ServerKit applications.
 *
 * Includes:
 * - **`CamelCasePlugin`** — Automatically translates snake_case database column
 *   names to camelCase in TypeScript, so `created_at` becomes `createdAt`.
 * - **`NullToUndefinedPlugin`** — Replaces `null` values in query results with
 *   `undefined`, aligning database output with TypeScript's preferred absence type.
 * - **`DateTimeParameterPlugin`** — Sends Luxon `DateTime` query parameters as ISO
 *   strings, the write side of `KyselyPgTypeOverrides`.
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
export const KyselyDefaultPlugins: KyselyPlugin[] = [new CamelCasePlugin(), new NullToUndefinedPlugin(), new DateTimeParameterPlugin()] as const;
