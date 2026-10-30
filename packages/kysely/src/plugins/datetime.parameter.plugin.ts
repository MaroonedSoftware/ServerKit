import {
  KyselyPlugin,
  OperationNodeTransformer,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  PrimitiveValueListNode,
  QueryResult,
  RootOperationNode,
  UnknownRow,
  ValueNode,
} from 'kysely';
import { DateTime } from 'luxon';

const toParameter = (value: unknown): unknown => {
  if (!DateTime.isDateTime(value)) return value;
  if (!value.isValid) throw new Error(`Cannot send an invalid DateTime to the database: ${value.invalidReason}`);
  return value.toISO();
};

class DateTimeParameterTransformer extends OperationNodeTransformer {
  protected override transformValue(node: ValueNode): ValueNode {
    return super.transformValue({ ...node, value: toParameter(node.value) });
  }

  protected override transformPrimitiveValueList(node: PrimitiveValueListNode): PrimitiveValueListNode {
    return super.transformPrimitiveValueList({ ...node, values: node.values.map(toParameter) });
  }
}

/**
 * A Kysely plugin that sends Luxon `DateTime` query parameters as ISO strings.
 *
 * `KyselyPgTypeOverrides` turns timestamps into `DateTime` on the way out; this
 * is the way back in. `DateTime` has no `toPostgres`, so `pg` would otherwise
 * `JSON.stringify` it, and that string reaches Postgres wrapped in double
 * quotes, which `timestamptz` only accepts because its parser skips punctuation.
 *
 * An invalid `DateTime` throws when the query is compiled rather than reaching
 * the database.
 *
 * This plugin is included in {@link KyselyDefaultPlugins} and does not need to
 * be registered separately when using that preset.
 *
 * @example
 * ```typescript
 * import { Kysely, PostgresDialect } from 'kysely';
 * import { DateTimeParameterPlugin } from '@maroonedsoftware/kysely';
 *
 * const db = new Kysely<Database>({
 *   dialect: new PostgresDialect({ pool }),
 *   plugins: [new DateTimeParameterPlugin()],
 * });
 * ```
 */
export class DateTimeParameterPlugin implements KyselyPlugin {
  private readonly transformer = new DateTimeParameterTransformer();

  /**
   * Replaces every `DateTime` value in the query with its ISO string.
   */
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    return this.transformer.transformNode(args.node, args.queryId);
  }

  /**
   * Passes the result through unchanged — no result transformation is needed.
   */
  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    return args.result;
  }
}
