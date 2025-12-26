import { HttpStatusMap } from './http.status.map.js';

/**
 * Type representing valid HTTP status codes from the HttpStatusMap.
 */
export type HttpStatusCodes = keyof typeof HttpStatusMap;

/**
 * Type representing the status message for a given HTTP status code.
 * @template T - The HTTP status code type.
 */
export type HttpStatusMessage<T extends HttpStatusCodes> = (typeof HttpStatusMap)[T];

/**
 * Custom error class for HTTP errors with support for status codes, details, headers, and error chaining.
 * Extends the native Error class and provides a fluent API for building error responses.
 *
 * @example
 * ```ts
 * throw new HttpError(404).withErrors({ field: 'not found' });
 * ```
 *
 * @example
 * ```ts
 * throw new HttpError(401)
 *   .withHeaders({ 'WWW-Authenticate': 'Bearer' })
 *   .withCause(originalError);
 * ```
 */
export class HttpError extends Error {
  /**
   * Optional validation or error details to include in the response.
   * Typically used for 400-level errors to provide field-specific error information.
   */
  details?: Record<string, unknown>;

  /**
   * Optional HTTP headers to include in the error response.
   * Useful for authentication errors (e.g., WWW-Authenticate header).
   */
  headers?: Record<string, string>;

  /**
   * Optional underlying error that caused this HTTP error.
   * Follows the Error.cause pattern for error chaining.
   */
  cause?: Error;

  /**
   * Optional internal details that should not be exposed to clients.
   * Useful for debugging and logging purposes.
   */
  internalDetails?: Record<string, unknown>;

  /**
   * Creates a new HttpError instance.
   *
   * @param statusCode - The HTTP status code (must be a key from HttpStatusMap).
   * @param message - Optional custom error message. If not provided, uses the default message from HttpStatusMap.
   */
  constructor(
    readonly statusCode: HttpStatusCodes,
    message?: HttpStatusMessage<HttpStatusCodes>,
  ) {
    super(message ?? HttpStatusMap[statusCode]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any)[Symbol.toStringTag] = 'Object';

    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, HttpError.prototype);
  }

  /**
   * Adds error details to the HTTP error and returns the instance for method chaining.
   *
   * @param errors - Object containing field-specific error information.
   * @returns The HttpError instance for method chaining.
   *
   * @example
   * ```ts
   * error.withErrors({ email: 'Invalid email format', password: 'Too short' });
   * ```
   */
  withErrors(errors: Record<string, unknown>): HttpError {
    this.details = errors;
    return this;
  }

  /**
   * Adds HTTP headers to the error response and returns the instance for method chaining.
   *
   * @param headers - Object containing HTTP header key-value pairs.
   * @returns The HttpError instance for method chaining.
   *
   * @example
   * ```ts
   * error.withHeaders({ 'WWW-Authenticate': 'Bearer realm="api"' });
   * ```
   */
  withHeaders(headers: Record<string, string>): HttpError {
    this.headers = headers;
    return this;
  }

  /**
   * Sets the underlying cause of this error and returns the instance for method chaining.
   *
   * @param cause - The original error that caused this HTTP error.
   * @returns The HttpError instance for method chaining.
   *
   * @example
   * ```ts
   * error.withCause(new Error('Database connection failed'));
   * ```
   */
  withCause(cause: Error): HttpError {
    this.cause = cause;
    return this;
  }

  /**
   * Adds internal details that should not be exposed to clients and returns the instance for method chaining.
   *
   * @param internalDetails - Object containing internal debugging information.
   * @returns The HttpError instance for method chaining.
   *
   * @example
   * ```ts
   * error.withInternalDetails({ userId: 123, requestId: 'abc-123' });
   * ```
   */
  withInternalDetails(internalDetails: Record<string, unknown>): HttpError {
    this.internalDetails = internalDetails;
    return this;
  }

  /**
   * Adds a HTTP header to the error response and returns the instance for method chaining.
   *
   * @param key - The HTTP header key.
   * @param value - The HTTP header value.
   * @returns The HttpError instance for method chaining.
   */
  addHeader(key: string, value: string): HttpError {
    this.headers ??= {};
    this.headers[key] = value;
    return this;
  }
}

/**
 * Type guard to check if an unknown value is an HttpError instance.
 *
 * @param error - The value to check.
 * @returns True if the value is an HttpError instance, false otherwise.
 *
 * @example
 * ```ts
 * if (IsHttpError(error)) {
 *   console.log(error.statusCode);
 * }
 * ```
 */
export const IsHttpError = (error: unknown): error is HttpError => {
  return error instanceof HttpError;
};

/**
 * Factory function to create an HttpError instance with a specific status code.
 *
 * @template StatusCode - The HTTP status code type.
 * @template StatusMessage - The status message type for the given status code.
 * @param statusCode - The HTTP status code.
 * @param message - Optional custom error message.
 * @returns A new HttpError instance.
 *
 * @example
 * ```ts
 * throw httpError(404);
 * ```
 */
export const httpError = <StatusCode extends HttpStatusCodes, StatusMessage extends HttpStatusMessage<StatusCode>>(
  statusCode: StatusCode,
  message?: StatusMessage,
) => new HttpError(statusCode, message);

/**
 * Factory function to create an unauthorized HttpError instance.
 *
 * @param error - The error message of the WWW-Authenticate header.
 * @returns A new HttpError instance with the WWW-Authenticate header set to the given error message.
 *
 * @example
 * ```ts
 * throw unauthorizedError('Bearer realm="api"');
 * ```
 */
export const unauthorizedError = (error: string) => httpError(401).addHeader('WWW-Authenticate', error);
