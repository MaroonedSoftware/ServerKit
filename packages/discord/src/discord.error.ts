import { ServerkitError } from '@maroonedsoftware/errors';

/**
 * Domain error raised by the Discord package for non-HTTP failures (e.g. a REST
 * call returned a non-2xx status, signature verification failed).
 *
 * Extends {@link ServerkitError} so `errorMiddleware` renders a 500 with
 * `{ message, details }` if one of these escapes a route handler. Inside route
 * handlers, throw `httpError(...)` directly for status-coded responses.
 */
export class DiscordError extends ServerkitError {}

/**
 * Type guard for {@link DiscordError}. Narrows `unknown` to `DiscordError` so
 * `details`, `internalDetails`, and the chainable setters are accessible without
 * further checks. Returns `true` for any subclass.
 */
export const IsDiscordError = (error: unknown): error is DiscordError => error instanceof DiscordError;
