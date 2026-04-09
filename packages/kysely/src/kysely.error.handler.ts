import { NoResultError } from 'kysely';
import { httpError } from '@maroonedsoftware/errors';

/**
 * Type guard that narrows `error` to a Kysely `NoResultError`.
 *
 * `NoResultError` is thrown by Kysely when `.executeTakeFirstOrThrow()` finds
 * no matching row.
 *
 * @param error - The error to test.
 * @returns `true` when `error` is a `NoResultError`, narrowing the type accordingly.
 *
 * @example
 * ```typescript
 * try {
 *   await db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
 * } catch (error) {
 *   if (isKyselyNoResultError(error)) {
 *     // error is now typed as NoResultError
 *   }
 * }
 * ```
 */
export const isKyselyNoResultError = (error: Error): error is NoResultError => {
  return error instanceof NoResultError;
};

/**
 * Error handler that maps Kysely errors to HTTP errors.
 *
 * - `NoResultError` → throws `HttpError(404)` with the original message in `details`
 * - All other errors → re-thrown unchanged
 *
 * Intended to be used with the `@OnError` decorator from `@maroonedsoftware/errors`,
 * or directly via the `@OnKyselyError` shorthand decorator.
 *
 * @param error - The error to handle.
 * @throws `HttpError(404)` for `NoResultError`, or the original error otherwise.
 *
 * @example
 * ```typescript
 * try {
 *   await userRepository.findById(id);
 * } catch (error) {
 *   KyselyErrorHandler(error);
 * }
 * ```
 */
export const KyselyErrorHandler = (error: Error) => {
  if (isKyselyNoResultError(error)) {
    throw httpError(404).withDetails({ message: error.message });
  } else {
    throw error;
  }
};
