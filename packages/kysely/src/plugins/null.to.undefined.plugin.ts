import { nullToUndefined } from '@maroonedsoftware/utilities';
import { KyselyPlugin, PluginTransformQueryArgs, PluginTransformResultArgs, RootOperationNode, QueryResult, UnknownRow } from 'kysely';

/**
 * A Kysely plugin that replaces `null` values in query results with `undefined`.
 *
 * PostgreSQL returns `NULL` as JavaScript `null`, but TypeScript code typically
 * uses `undefined` to represent absent values. This plugin performs a shallow
 * conversion on every row returned by a query, making result types consistent
 * with the rest of a TypeScript codebase.
 *
 * This plugin is included in {@link KyselyDefaultPlugins} and does not need to
 * be registered separately when using that preset.
 *
 * @example
 * ```typescript
 * import { Kysely, PostgresDialect } from 'kysely';
 * import { NullToUndefinedPlugin } from '@maroonedsoftware/kysely';
 *
 * const db = new Kysely<Database>({
 *   dialect: new PostgresDialect({ pool }),
 *   plugins: [new NullToUndefinedPlugin()],
 * });
 * ```
 */
export class NullToUndefinedPlugin implements KyselyPlugin {
  /**
   * Passes the query node through unchanged — no query transformation is needed.
   */
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return args.node; // no query transformation needed
  }

  /**
   * Replaces every `null` value in each result row with `undefined`.
   *
   * The conversion is shallow: only top-level properties of each row object are
   * processed. Nested objects are passed through as-is.
   */
  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return {
      ...args.result,
      rows: args.result.rows.map(row => nullToUndefined(row)),
    };
  }
}
