import { Injectable } from 'injectkit';
import { Db } from 'pg-boss';

/**
 * Supplies the pg-boss database executor used when enqueuing or scheduling jobs.
 *
 * pg-boss accepts an optional `db` ({@link Db}) on its send/schedule options. When
 * provided, the job-insert SQL runs on that executor's connection instead of
 * pg-boss's own pool — letting an enqueue participate in an in-flight database
 * transaction so the job row and the surrounding business writes commit or roll
 * back together.
 *
 * The default implementation returns `undefined`, which makes pg-boss fall back
 * to its internal pool (i.e. the standard, non-transactional behavior). To enqueue
 * jobs transactionally, register an override on a request-scoped DI container whose
 * {@link executor} returns a transaction-bound executor — for example pg-boss's
 * `fromKysely(trx)` adapter wrapping the active Kysely transaction.
 *
 * @example
 * ```typescript
 * import { fromKysely } from 'pg-boss';
 * import { PgBossConnectionProvider } from '@maroonedsoftware/jobbroker';
 *
 * // In request scope, bind a provider backed by the active transaction.
 * class TransactionalConnectionProvider extends PgBossConnectionProvider {
 *   constructor(private readonly trx: Transaction<DB>) {
 *     super();
 *   }
 *
 *   override executor() {
 *     return fromKysely(this.trx);
 *   }
 * }
 * ```
 */
@Injectable()
export class PgBossConnectionProvider {
  /**
   * Returns the pg-boss executor to run job-insert SQL against, or `undefined`
   * to use pg-boss's internal connection pool.
   *
   * @returns A transaction-bound {@link Db} executor, or `undefined` for the
   *          default pooled (non-transactional) behavior.
   */
  executor(): Db | undefined {
    return undefined;
  }
}
