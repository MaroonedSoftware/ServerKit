import { ServerkitError } from '@maroonedsoftware/errors';

/**
 * Domain error raised by the Telegram package for non-HTTP failures (e.g. a Bot
 * API call returned `ok: false` or a non-2xx status, secret-token verification
 * failed).
 *
 * Extends {@link ServerkitError} so `errorMiddleware` renders a 500 with
 * `{ message, details }` if one of these escapes a route handler. Inside route
 * handlers, throw `httpError(...)` directly for status-coded responses.
 */
export class TelegramError extends ServerkitError {}

/**
 * Type guard for {@link TelegramError}. Narrows `unknown` to `TelegramError` so
 * `details`, `internalDetails`, and the chainable setters are accessible without
 * further checks. Returns `true` for any subclass.
 */
export const IsTelegramError = (error: unknown): error is TelegramError => error instanceof TelegramError;
