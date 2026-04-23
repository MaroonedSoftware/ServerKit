import { PostgresErrorHandler } from './postgres.error.handler.js';
import { OnError } from '../on.error.decorator.js';

/**
 * Class decorator that automatically maps PostgreSQL errors to HTTP errors on all methods.
 *
 * A convenience wrapper around `@OnError(PostgresErrorHandler)`. When applied to a
 * repository or service class, every method is wrapped so that:
 * - `23505` (unique violation) → `HttpError(409)`
 * - `23503` (foreign key violation) → `HttpError(404)`
 * - `22xxx` / `23502` / `23514` (validation) → `HttpError(400)`
 * - Transaction rollbacks and deadlocks → `HttpError(500)`
 * - Non-Postgres errors are re-thrown unchanged
 *
 * @returns A class decorator that installs {@link PostgresErrorHandler} on every method.
 *
 * @example
 * ```typescript
 * @OnPostgresError()
 * export class UserRepository {
 *   async createUser(data: NewUser) {
 *     // Unique constraint violations become HTTP 409 automatically
 *     return await db.insert(users).values(data).returning();
 *   }
 * }
 * ```
 */
export const OnPostgresError = () => OnError(PostgresErrorHandler);
