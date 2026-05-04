import { ServerkitError } from '@maroonedsoftware/errors';

/**
 * Domain error raised by the Slack package for non-HTTP failures (e.g.
 * incoming-webhook POST failed, unknown handler dispatch).
 *
 * Extends {@link ServerkitError} so `errorMiddleware` renders a 500 with
 * `{ message, details }` if one of these escapes a route handler. Inside
 * route handlers, throw `httpError(...)` directly for status-coded responses.
 */
export class SlackError extends ServerkitError {}

/**
 * Type guard for {@link SlackError}. Narrows `unknown` to `SlackError` so
 * `details`, `internalDetails`, and the chainable setters are accessible
 * without further checks. Returns `true` for any subclass.
 */
export const IsSlackError = (error: unknown): error is SlackError => error instanceof SlackError;
