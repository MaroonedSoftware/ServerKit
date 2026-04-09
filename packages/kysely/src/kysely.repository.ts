import { Injectable } from 'injectkit';
import { Kysely, Transaction } from 'kysely';

/**
 * Abstract base class for Kysely-backed repositories.
 *
 * Provides transaction helpers that support optional transaction propagation —
 * if a transaction is already in progress it is reused, otherwise a new one is
 * started. Registers with the InjectKit DI container via `@Injectable()`.
 *
 * @typeParam DB - The Kysely database schema type.
 *
 * @example
 * ```typescript
 * import { Injectable } from 'injectkit';
 * import { Kysely } from 'kysely';
 * import { KyselyRepository } from '@maroonedsoftware/kysely';
 * import { Database } from './database.js';
 *
 * @Injectable()
 * export class UserRepository extends KyselyRepository<Database> {
 *   constructor(db: Kysely<Database>) {
 *     super(db);
 *   }
 *
 *   async createUser(data: NewUser): Promise<User> {
 *     return this.withTransaction(async trx => {
 *       return trx.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow();
 *     });
 *   }
 * }
 * ```
 */
@Injectable()
export abstract class KyselyRepository<DB> {
  constructor(protected readonly db: Kysely<DB>) {}

  /**
   * Executes a callback inside a database transaction.
   *
   * If a `transaction` is provided it is passed directly to the callback without
   * starting a new transaction, enabling transaction propagation across multiple
   * repository calls. When no transaction is provided a new default transaction
   * is started and automatically committed or rolled back.
   *
   * @typeParam TResult - The type returned by the callback.
   * @param method - The callback to execute within the transaction.
   * @param transaction - An existing transaction to reuse, if any.
   * @returns The value returned by `method`.
   *
   * @example
   * ```typescript
   * // Start a new transaction
   * const user = await this.withTransaction(async trx => {
   *   const user = await trx.insertInto('users').values(data).returningAll().executeTakeFirstOrThrow();
   *   await trx.insertInto('audit_log').values({ userId: user.id, action: 'created' }).execute();
   *   return user;
   * });
   *
   * // Propagate an existing transaction
   * await this.withTransaction(async trx => { ... }, existingTrx);
   * ```
   */
  async withTransaction<TResult>(method: (transaction: Transaction<DB>) => Promise<TResult>, transaction?: Transaction<DB>): Promise<TResult> {
    if (!transaction) {
      return this.db.transaction().execute(async trx => {
        return await method(trx);
      });
    }
    return await method(transaction);
  }

  /**
   * Executes a callback inside a serializable database transaction.
   *
   * Behaves identically to {@link withTransaction} but sets the transaction
   * isolation level to `serializable`, providing the strongest ACID guarantees.
   * Use this when concurrent reads and writes must see a consistent snapshot of
   * the database (e.g. balance transfers, inventory adjustments).
   *
   * If a `transaction` is provided it is reused as-is — the isolation level
   * cannot be changed on an in-progress transaction.
   *
   * @typeParam TResult - The type returned by the callback.
   * @param method - The callback to execute within the serializable transaction.
   * @param transaction - An existing transaction to reuse, if any.
   * @returns The value returned by `method`.
   *
   * @example
   * ```typescript
   * const result = await this.withSerializedTransaction(async trx => {
   *   const balance = await trx.selectFrom('accounts').select('balance').where('id', '=', id).executeTakeFirstOrThrow();
   *   await trx.updateTable('accounts').set({ balance: balance.balance - amount }).where('id', '=', id).execute();
   *   return balance;
   * });
   * ```
   */
  async withSerializedTransaction<TResult>(
    method: (transaction: Transaction<DB>) => Promise<TResult>,
    transaction?: Transaction<DB>,
  ): Promise<TResult> {
    if (!transaction) {
      return this.db
        .transaction()
        .setIsolationLevel('serializable')
        .execute(async trx => {
          return await method(trx);
        });
    }
    return await method(transaction);
  }
}
