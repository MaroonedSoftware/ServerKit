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

// Postgres SQLSTATE codes are 5 characters, each upper-case A-Z or 0-9 — see
// https://www.postgresql.org/docs/current/errcodes-appendix.html. Matching
// against this shape avoids mis-classifying generic Node errors (e.g. fs
// `ENOENT`) whose `code` is also a string.
const POSTGRES_CODE_PATTERN = /^[0-9A-Z]{5}$/;

/**
 * Type guard that narrows to {@link PostgresError} by checking for a string `code`
 * property in the 5-character SQLSTATE shape. Generic Node errors with a `code`
 * (e.g. `ENOENT`, `EPERM`) are intentionally rejected so they don't get routed
 * through the Postgres mapper and emerge as opaque HTTP 500s.
 *
 * @param error - The error to check.
 * @returns `true` when `error.code` matches `/^[0-9A-Z]{5}$/`.
 *
 * @example
 * ```ts
 * if (isPostgresError(error)) {
 *   console.log(error.code); // '23505'
 * }
 * ```
 */
export const isPostgresError = (error: Error): error is PostgresError => {
  if (!('code' in error)) return false;
  const code = (error as { code: unknown }).code;
  return typeof code === 'string' && POSTGRES_CODE_PATTERN.test(code);
};

/**
 * Handles PostgreSQL errors by converting them to appropriate HTTP errors.
 * Maps PostgreSQL error codes to HTTP status codes:
 * - 23505 (unique constraint violation) → 409 Conflict
 * - 23503 (foreign key violation) → 404 Not Found
 * - 23502, 22P02, 22003, 22004, 22023, 23514 (validation errors) → 400 Bad Request
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
      case '22000':
      case '22003':
      case '22004':
      case '22023':
      case '23502':
      case '22P02':
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
