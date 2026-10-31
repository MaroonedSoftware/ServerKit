import {
  KyselyPlugin,
  OperationNode,
  OperationNodeTransformer,
  PluginTransformQueryArgs,
  PluginTransformResultArgs,
  QueryId,
  QueryResult,
  RootOperationNode,
  TableNode,
  UnknownRow,
} from 'kysely';

/**
 * Options for {@link StripSysPeriodPlugin}.
 */
export interface StripSysPeriodPluginOptions {
  /** The result keys to remove. Defaults to `sysPeriod` and `sys_period`, so it works with or without `CamelCasePlugin`. */
  columns?: readonly string[];
  /** A query touching a table whose name ends with this keeps its columns. Defaults to `_history`. */
  historySuffix?: string;
}

/** Finds a table with the given suffix anywhere in a query: `FROM`, joins, `WITH` and set operations alike. */
class HistoryTableFinder extends OperationNodeTransformer {
  #found = false;

  constructor(private readonly suffix: string) {
    super();
  }

  find(node: OperationNode): boolean {
    this.transformNode(node);
    return this.#found;
  }

  protected override transformTable(node: TableNode, queryId?: QueryId): TableNode {
    this.#found ||= node.table.identifier.name.endsWith(this.suffix);
    return super.transformTable(node, queryId);
  }
}

/**
 * A Kysely plugin that keeps a system-versioned table's period column out of query results.
 *
 * Temporal tables carry a `sys_period` column that callers rarely want, and that `selectAll` would
 * otherwise return from every read. This removes it from each row of a built query. A query that
 * touches a history table keeps it, since the period is the point of reading history, and so does a
 * raw `sql` query, which asked for what it selected.
 *
 * Not part of {@link KyselyDefaultPlugins}: only an app with versioned tables needs it. Register it
 * after `CamelCasePlugin`, which is what puts a table's name into `snake_case` for the suffix check.
 *
 * The history check reads table references only, so a history table named inside a `sql` fragment of
 * a built query is not seen.
 *
 * @example
 * ```typescript
 * import { Kysely } from 'kysely';
 * import { KyselyDefaultPlugins, StripSysPeriodPlugin } from '@maroonedsoftware/kysely';
 *
 * const db = new Kysely<Database>({
 *   dialect,
 *   plugins: [...KyselyDefaultPlugins, new StripSysPeriodPlugin()],
 * });
 * ```
 */
export class StripSysPeriodPlugin implements KyselyPlugin {
  private readonly stripQueryIds = new WeakSet<object>();
  private readonly columns: ReadonlySet<string>;
  private readonly historySuffix: string;

  constructor(options: StripSysPeriodPluginOptions = {}) {
    this.columns = new Set(options.columns ?? ['sysPeriod', 'sys_period']);
    this.historySuffix = options.historySuffix ?? '_history';
  }

  /**
   * Marks the query for stripping unless it is raw or touches a history table. The node is unchanged.
   */
  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    if (args.node.kind !== 'RawNode' && !new HistoryTableFinder(this.historySuffix).find(args.node)) {
      this.stripQueryIds.add(args.queryId);
    }
    return args.node;
  }

  /**
   * Removes the configured columns from each row of a marked query.
   */
  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> {
    if (!this.stripQueryIds.has(args.queryId)) {
      return args.result;
    }
    return {
      ...args.result,
      rows: args.result.rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !this.columns.has(key)))),
    };
  }
}
