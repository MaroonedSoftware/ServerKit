import {
  AliasNode,
  PostgresDialect,
  PostgresQueryCompiler,
  SelectAllNode,
  SelectionNode,
  SelectQueryNode,
  TableNode,
  UpdateQueryNode,
  type OperationNode,
  type PostgresDialectConfig,
  type QueryCompiler,
  type RootOperationNode,
} from 'kysely';

/**
 * Minimal structural logger accepted by {@link EmptyUpdateRewriteDialect}.
 *
 * Any object with a `debug(message: string)` method satisfies it — including
 * the `Logger` from `@maroonedsoftware/logger` — so the dialect can emit a
 * diagnostic line without taking a hard dependency on a logging package.
 */
export interface EmptyUpdateRewriteLogger {
  debug(message: string): void;
}

/**
 * A PostgreSQL dialect that turns an empty `UPDATE` into a no-op `SELECT` of the
 * current row instead of letting it fail.
 *
 * Kysely silently drops `undefined`-valued keys from `.set()`, so an update
 * built from a PATCH-style body whose fields all arrived `undefined` (or an
 * explicit `.set({})`) compiles to `UPDATE ... SET WHERE ...` with an empty
 * `SET` clause. PostgreSQL rejects that with error `42601` (syntax error). This
 * dialect rewrites such empty updates so they become a harmless no-op that
 * returns the current, unchanged row — preserving the contract of
 * `.returningAll().executeTakeFirstOrThrow()` and friends.
 *
 * **Why a custom compiler and not a `KyselyPlugin`?** A plugin can't do this:
 * `QueryExecutor.transformQuery` enforces that a plugin returns a node of the
 * *same kind* it was given, so it cannot turn an `UpdateQueryNode` into a
 * `SelectQueryNode`. The compiler has no such rule — the node stays an
 * `UpdateQueryNode` (so `.execute()` still resolves an update result with
 * `numUpdatedRows` of `0n`), but we emit `SELECT` SQL for it when there are no
 * columns to set. No row is written, so no `UPDATE` trigger fires (audit logs,
 * `temporal_tables` history, etc. stay untouched), and the returned rows still
 * flow through the executor's `transformResult` chain — including
 * {@link KyselyDefaultPlugins} (camelCase, null→undefined) — so callers see the
 * usual row shape.
 *
 * Multi-table `UPDATE ... FROM` / join updates with an empty `SET` are left to
 * fail: faithfully turning them into a `SELECT` is out of scope and such a
 * statement is almost certainly a bug.
 *
 * @example
 * ```typescript
 * import { Kysely } from 'kysely';
 * import { EmptyUpdateRewriteDialect, KyselyDefaultPlugins, KyselyPool } from '@maroonedsoftware/kysely';
 *
 * const db = new Kysely<Database>({
 *   dialect: new EmptyUpdateRewriteDialect({ pool }, logger),
 *   plugins: KyselyDefaultPlugins,
 * });
 *
 * // Resolves to the unchanged row instead of throwing a 42601 syntax error:
 * await db.updateTable('persons').set({}).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
 * ```
 */
export class EmptyUpdateRewriteDialect extends PostgresDialect {
  constructor(
    config: PostgresDialectConfig,
    private readonly logger?: EmptyUpdateRewriteLogger,
  ) {
    super(config);
  }

  override createQueryCompiler(): QueryCompiler {
    return new EmptyUpdateRewriteCompiler(this.logger);
  }
}

/**
 * The {@link PostgresQueryCompiler} used by {@link EmptyUpdateRewriteDialect}.
 * Exported for advanced composition (e.g. wiring it into a custom dialect); most
 * callers should use {@link EmptyUpdateRewriteDialect} directly.
 */
export class EmptyUpdateRewriteCompiler extends PostgresQueryCompiler {
  constructor(private readonly logger?: EmptyUpdateRewriteLogger) {
    super();
  }

  protected override visitUpdateQuery(node: UpdateQueryNode): void {
    const select = emptyUpdateToSelect(node);
    if (select) {
      this.logger?.debug(`EmptyUpdateRewriteDialect: empty UPDATE compiled as a no-op SELECT (table: ${describeTable(node.table!)})`);
      // Shares this compiler's SQL buffer, so the statement is emitted as
      // `select ... from ... where ...` instead of the invalid empty
      // `update ... set`.
      this.visitSelectQuery(select);
      return;
    }
    super.visitUpdateQuery(node);
  }
}

/**
 * Builds a `SELECT` of the current row for an empty `UPDATE`, or returns
 * `undefined` when the node is not an empty single-table update (and should
 * compile unchanged).
 */
function emptyUpdateToSelect(node: RootOperationNode): SelectQueryNode | undefined {
  if (!UpdateQueryNode.is(node)) {
    return undefined;
  }
  // A normal update with columns to set compiles as-is.
  if (node.updates && node.updates.length > 0) {
    return undefined;
  }
  if (!node.table) {
    return undefined;
  }
  // Multi-table UPDATE ... FROM / JOIN with an empty SET is almost certainly a
  // bug, and faithfully turning it into a SELECT is out of scope; let the DB
  // surface the error.
  if (node.from || (node.joins && node.joins.length > 0)) {
    return undefined;
  }

  let select = SelectQueryNode.createFrom([node.table], node.with);

  // ReturningNode.selections is the same SelectionNode[] a SELECT uses, so
  // `RETURNING *` / `RETURNING cols` maps over 1:1. A bare `.execute()` update
  // has no RETURNING; select all so the SQL stays valid (the rows are ignored
  // and `.execute()` resolves numUpdatedRows to 0n).
  const selections = node.returning?.selections.length ? node.returning.selections : [SelectionNode.create(SelectAllNode.create())];
  select = SelectQueryNode.cloneWithSelections(select, selections);

  return { ...select, where: node.where };
}

/**
 * Best-effort human-readable name for the update target, for the debug log only.
 */
function describeTable(node: OperationNode): string {
  if (AliasNode.is(node)) {
    return describeTable(node.node);
  }
  if (TableNode.is(node)) {
    const { schema, identifier } = node.table;
    return schema ? `${schema.name}.${identifier.name}` : identifier.name;
  }
  return node.kind;
}
