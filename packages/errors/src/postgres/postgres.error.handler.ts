import { httpError, type HttpStatusCodes } from '../http/http.error.js';

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

/** How a given SQLSTATE code maps to an HTTP response: a status and, for opaque 500s, internal-only context for logging. */
interface PostgresErrorMapping {
  status: HttpStatusCodes;
  internal?: Record<string, unknown>;
}

/**
 * SQLSTATE code → HTTP mapping. Codes absent from this table fall through to a
 * bare 500 (see {@link PostgresErrorHandler}). Grouped by response class:
 * - 23505 (unique violation) → 409; 23503 (FK violation) → 409
 * - validation-shaped codes → 400
 * - transaction rollback / deadlock → 500 with an internal `msg` for logs
 */
const POSTGRES_ERROR_MAP: Record<string, PostgresErrorMapping> = {
  '23505': { status: 409 },
  '23503': { status: 409 },
  '22000': { status: 400 },
  '22003': { status: 400 },
  '22004': { status: 400 },
  '22023': { status: 400 },
  '23502': { status: 400 },
  '22P02': { status: 400 },
  '23514': { status: 400 },
  '40000': { status: 500, internal: { msg: 'Transaction rollback' } },
  '40001': { status: 500, internal: { msg: 'Transaction rollback' } },
  '40002': { status: 500, internal: { msg: 'Transaction rollback' } },
  '40P01': { status: 500, internal: { msg: 'Deadlock' } },
};

/**
 * Handles PostgreSQL errors by converting them to appropriate HTTP errors.
 * Maps PostgreSQL error codes to HTTP status codes:
 * - 23505 (unique constraint violation) → 409 Conflict
 * - 23503 (foreign key violation) → 409 Conflict
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
  if (!isPostgresError(error)) throw error;
  const mapping = POSTGRES_ERROR_MAP[error.code] ?? { status: 500 };
  const mapped = httpError(mapping.status).withCause(error);
  throw mapping.internal ? mapped.withInternalDetails(mapping.internal) : mapped;
};
