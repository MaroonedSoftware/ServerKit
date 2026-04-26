import { ServerkitError } from '../serverkit.error.js';
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
 * HTTP error with status code and optional response headers.
 *
 * Extends {@link ServerkitError}, so instances also carry `details`, `cause`,
 * and `internalDetails`, and inherit the fluent setters
 * `withDetails` / `withCause` / `withInternalDetails` in addition to the
 * HTTP-specific {@link withHeaders} and {@link addHeader}.
 *
 * The {@link errorMiddleware} in `@maroonedsoftware/koa` recognises instances
 * via {@link IsHttpError} and serialises them to the response.
 *
 * @example
 * ```ts
 * throw new HttpError(404).withDetails({ field: 'not found' });
 * ```
 *
 * @example
 * ```ts
 * throw new HttpError(401)
 *   .withHeaders({ 'WWW-Authenticate': 'Bearer' })
 *   .withCause(originalError);
 * ```
 */
export class HttpError extends ServerkitError {
  /**
   * Optional HTTP headers to include in the error response.
   * Useful for authentication errors (e.g., WWW-Authenticate header).
   */
  headers?: Record<string, string>;

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
    // 👇️ because we are extending a built-in class
    Object.setPrototypeOf(this, HttpError.prototype);
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
