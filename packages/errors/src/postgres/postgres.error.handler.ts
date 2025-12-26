import { httpError } from '../http/http.error.js';

/**
 * Interface representing a PostgreSQL error with a specific error code.
 * PostgreSQL errors include a `code` property that identifies the type of error.
 */
export interface PostgresError extends Error {
  /**
   * PostgreSQL error code (e.g., '23505' for unique constraint violation).
   */
  code: string;
}

/**
 * Type guard to check if an error is a PostgreSQL error with a code property.
 *
 * @param error - The error to check.
 * @returns True if the error has a `code` property, false otherwise.
 *
 * @example
 * ```ts
 * if (isPostgresError(error)) {
 *   console.log(error.code); // '23505'
 * }
 * ```
 */
export const isPostgresError = (error: Error): error is PostgresError => {
  return 'code' in error;
};

/**
 * Handles PostgreSQL errors by converting them to appropriate HTTP errors.
 * Maps PostgreSQL error codes to HTTP status codes:
 * - 23505 (unique constraint violation) → 409 Conflict
 * - 23503 (foreign key violation) → 404 Not Found
 * - 23502, 22P02, 22003, 23514 (validation errors) → 400 Bad Request
 * - 40000, 40001, 40002 (transaction rollback) → 500 Internal Server Error
 * - 40P01 (deadlock) → 500 Internal Server Error
 * - Unknown codes → 500 Internal Server Error
 *
 * If the error is not a PostgreSQL error, it is re-thrown as-is.
 *
 * @param error - The error to handle.
 * @throws {HttpError} An HttpError with the appropriate status code and cause.
 * @throws {Error} The original error if it's not a PostgreSQL error.
 *
 * @example
 * ```ts
 * try {
 *   await db.insert(...);
 * } catch (error) {
 *   PostgresErrorHandler(error); // Converts to HttpError
 * }
 * ```
 */
export const PostgresErrorHandler = (error: Error) => {
  if (isPostgresError(error)) {
    switch (error.code) {
      case '23505':
        throw httpError(409).withCause(error);
      case '23503':
        throw httpError(404).withCause(error);
      case '23502':
      case '22P02':
      case '22003':
      case '23514':
        throw httpError(400).withCause(error);
      case '40000':
      case '40001':
      case '40002':
        throw httpError(500).withCause(error).withInternalDetails({ msg: 'Transaction rollback' });
      case '40P01':
        throw httpError(500).withCause(error).withInternalDetails({ msg: 'Deadlock' });
      default:
        throw httpError(500).withCause(error);
    }
  } else {
    throw error;
  }
};
