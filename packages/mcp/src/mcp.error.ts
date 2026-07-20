import { ServerkitError } from '@maroonedsoftware/errors';

/**
 * Domain error raised by the MCP package for non-HTTP failures (e.g. a tool was
 * invoked outside a request context, no handler is registered for a method,
 * bearer verification failed).
 *
 * Extends {@link ServerkitError} so `errorMiddleware` renders a 500 with
 * `{ message, details }` if one escapes a route handler. Inside route handlers,
 * throw `httpError(...)` directly for status-coded responses; auth denials are
 * surfaced as HTTP 401 by the policy/middleware, not by throwing this directly.
 */
export class McpError extends ServerkitError {}

/**
 * Type guard for {@link McpError}. Narrows `unknown` to `McpError` so `details`,
 * `internalDetails`, and the chainable setters are accessible without further
 * checks. Returns `true` for any subclass.
 */
export const IsMcpError = (error: unknown): error is McpError => error instanceof McpError;
