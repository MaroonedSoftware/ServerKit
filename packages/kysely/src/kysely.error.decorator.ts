import { OnError } from '@maroonedsoftware/errors';
import { KyselyErrorHandler } from './kysely.error.handler.js';

/**
 * Class decorator that automatically maps Kysely errors to HTTP errors on all methods.
 *
 * A convenience wrapper around `@OnError(KyselyErrorHandler)`. When applied to a
 * repository or service class, every method is wrapped so that:
 * - `NoResultError` becomes an `HttpError(404)`
 * - All other errors are re-thrown unchanged
 *
 * @returns A class decorator that installs {@link KyselyErrorHandler} on every method.
 *
 * @example
 * ```typescript
 * import { OnKyselyError } from '@maroonedsoftware/kysely';
 *
 * @OnKyselyError()
 * export class UserRepository extends KyselyRepository<Database> {
 *   async findById(id: number): Promise<User> {
 *     // NoResultError is automatically converted to HTTP 404
 *     return this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
 *   }
 * }
 * ```
 */
export const OnKyselyError = () => OnError(KyselyErrorHandler);
