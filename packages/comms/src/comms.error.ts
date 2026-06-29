import { ServerkitError } from '@maroonedsoftware/errors';

/**
 * Domain error raised by the comms layer (e.g. `sendTemplate` for an
 * unregistered template name).
 *
 * Extends {@link ServerkitError} so `errorMiddleware` renders a 500 with
 * `{ message, details }` if one escapes a route handler.
 */
export class CommsError extends ServerkitError {}

/**
 * Type guard for {@link CommsError}. Narrows `unknown` to `CommsError`. Returns
 * `true` for any subclass.
 */
export const IsCommsError = (error: unknown): error is CommsError => error instanceof CommsError;
