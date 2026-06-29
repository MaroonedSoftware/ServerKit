import { ServerkitError } from '@maroonedsoftware/errors';

/**
 * Domain error raised by the WhatsApp package for non-HTTP failures (e.g. a
 * Graph API call returned a non-2xx status, signature verification failed,
 * webhook verification handshake failed).
 *
 * Extends {@link ServerkitError} so `errorMiddleware` renders a 500 with
 * `{ message, details }` if one of these escapes a route handler. Inside route
 * handlers, throw `httpError(...)` directly for status-coded responses.
 */
export class WhatsAppError extends ServerkitError {}

/**
 * Type guard for {@link WhatsAppError}. Narrows `unknown` to `WhatsAppError` so
 * `details`, `internalDetails`, and the chainable setters are accessible without
 * further checks. Returns `true` for any subclass.
 */
export const IsWhatsAppError = (error: unknown): error is WhatsAppError => error instanceof WhatsAppError;
