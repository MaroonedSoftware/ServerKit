import { PgBossConnectionProvider } from './pgboss.connection.provider.js';
import { fromKysely, type Db } from 'pg-boss';

/**
 * Structural shape of a Kysely instance or transaction, matching what pg-boss's
 * `fromKysely` adapter consumes.
 *
 * Declared structurally rather than as `Kysely<DB>` so the package carries no
 * dependency (not even an optional peer) on `kysely`, and so both `Kysely<DB>`
 * and `Transaction<DB>` are accepted without a type argument or a cast.
 */
export interface KyselyLike {
  withoutPlugins(): Parameters<typeof fromKysely>[0];
}

/**
 * {@link PgBossConnectionProvider} bound to an active Kysely transaction, so
 * jobs enqueued while that transaction is open commit or roll back with it.
 *
 * Register it as a request-scoped override of {@link PgBossConnectionProvider}
 * alongside whatever binds the transaction itself, and every enqueue performed
 * during the request inserts on the transaction's connection instead of
 * pg-boss's pool — closing the dual-write gap between domain writes and job
 * enqueues.
 *
 * Plugins are stripped before the transaction is adapted: pg-boss runs raw SQL
 * straight through `executeQuery`, so a column-rewriting plugin on the caller's
 * instance (a camel-case mapper, for example) would corrupt pg-boss's own
 * result columns. `withoutPlugins()` returns an instance sharing the same
 * connection-bound executor, so atomicity is preserved.
 *
 * @example
 * ```typescript
 * await db.transaction().execute(async trx => {
 *   const scope = container.createScope();
 *   scope.override(PgBossConnectionProvider, new KyselyTransactionConnectionProvider(trx));
 *
 *   await repository.createOrder(trx, order);
 *   await scope.get(JobBroker).send(new SendReceiptJob({ orderId: order.id }));
 * });
 * ```
 */
export class KyselyTransactionConnectionProvider extends PgBossConnectionProvider {
  /**
   * @param trx - The active Kysely transaction (or any Kysely instance) whose
   *              connection job inserts should run on.
   */
  constructor(private readonly trx: KyselyLike) {
    super();
  }

  /**
   * Returns the transaction's connection adapted to pg-boss's executor shape,
   * with the caller's Kysely plugins stripped.
   *
   * @returns A {@link Db} executor bound to the transaction's connection.
   */
  override executor(): Db {
    return fromKysely(this.trx.withoutPlugins());
  }
}
