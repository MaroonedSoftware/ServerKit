/**
 * Base class for ServerKit errors. Adds three optional, response-shaping fields
 * to the native `Error` — `details`, `cause`, `internalDetails` — and exposes
 * fluent setters (`withDetails`, `withCause`, `withInternalDetails`) so
 * concrete error classes can be built up at the throw site.
 *
 * Subclass this for any non-HTTP error you want the `errorMiddleware` to render
 * with `details` exposed in the response body. The middleware maps a bare
 * `ServerkitError` to HTTP 500 with `{ message, details }`. For HTTP errors,
 * use {@link HttpError} (which extends this) — it adds a status code and
 * response headers.
 *
 * @example
 * ```ts
 * class DomainError extends ServerkitError {}
 *
 * throw new DomainError('Quota exceeded')
 *   .withDetails({ resource: 'invoices', limit: 100 })
 *   .withInternalDetails({ accountId: 'acct_42' });
 * ```
 */
export class ServerkitError extends Error {
  /**
   * Optional validation or error details to include in the response.
   */
  details?: Record<string, unknown>;

  /**
   * Optional underlying error that caused this Serverkit error.
   * Follows the Error.cause pattern for error chaining.
   */
  cause?: Error;

  /**
   * Optional internal details that should not be exposed to clients.
   * Useful for debugging and logging purposes.
   */
  internalDetails?: Record<string, unknown>;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any)[Symbol.toStringTag] = 'Object';

    // Restore the prototype to the actual class used with `new` (workaround
    // for the historic Error-subclass instanceof bug in transpilers / older
    // V8). Using `new.target.prototype` instead of `ServerkitError.prototype`
    // means subclasses get correct `instanceof` behaviour without each one
    // having to replicate this line.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Adds error details to the Serverkit error and returns the instance for method chaining.
   *
   * @param details - Object containing field-specific error information.
   * @returns The error instance for method chaining.
   *
   * @example
   * ```ts
   * error.withDetails({ email: 'Invalid email format', password: 'Too short' });
   * ```
   */
  withDetails(details: Record<string, unknown>) {
    this.details = details;
    return this;
  }

  /**
   * Sets the underlying cause of this error and returns the instance for method chaining.
   *
   * @param cause - The original error that caused this Serverkit error.
   * @returns The error instance for method chaining.
   *
   * @example
   * ```ts
   * error.withCause(new Error('Database connection failed'));
   * ```
   */
  withCause(cause: Error) {
    this.cause = cause;
    return this;
  }

  /**
   * Adds internal details that should not be exposed to clients and returns the instance for method chaining.
   *
   * @param internalDetails - Object containing internal debugging information.
   * @returns The error instance for method chaining.
   *
   * @example
   * ```ts
   * error.withInternalDetails({ userId: 123, requestId: 'abc-123' });
   * ```
   */
  withInternalDetails(internalDetails: Record<string, unknown>) {
    this.internalDetails = internalDetails;
    return this;
  }
}

/**
 * Type guard for {@link ServerkitError}. Narrows `unknown` to `ServerkitError`
 * (so `details`, `cause`, `internalDetails`, and the chainable setters are
 * accessible without further type checks). Returns `true` for any subclass —
 * including {@link HttpError} and `KmsError`.
 *
 * @example
 * ```ts
 * try {
 *   await doWork();
 * } catch (err) {
 *   if (IsServerkitError(err)) {
 *     logger.error('serverkit error', { details: err.details, cause: err.cause });
 *   }
 *   throw err;
 * }
 * ```
 */
export const IsServerkitError = (error: unknown): error is ServerkitError => {
  return error instanceof ServerkitError;
};
