import { HttpError } from '@maroonedsoftware/errors';
import type { OAuthErrorCode } from './oauth.types.js';

/** An OAuth error body ([RFC 6749 §5.2](https://datatracker.ietf.org/doc/html/rfc6749#section-5.2)). */
export interface OAuthErrorBody {
  error: OAuthErrorCode;
  error_description: string;
}

/**
 * An OAuth protocol failure carrying its RFC error code.
 *
 * It is an {@link HttpError} with status 400 (or 401, for `invalid_client` on
 * an authenticated request) and `details` of `{ error, error_description }`, so
 * an uncaught one renders as a 4xx carrying the RFC fields. A route that must
 * answer with the exact RFC body renders {@link OAuthError.toBody} itself.
 *
 * `description` is sent to the client. Never put a secret, a token, or an
 * internal identifier in it; use `withInternalDetails` for what only the log
 * should see.
 */
export class OAuthError extends HttpError {
  constructor(
    readonly code: OAuthErrorCode,
    readonly description: string,
    status: 400 | 401 = 400,
  ) {
    super(status);
    this.withDetails({ error: code, error_description: description });
  }

  /** The RFC 6749 §5.2 error body. */
  toBody(): OAuthErrorBody {
    return { error: this.code, error_description: this.description };
  }
}

/** Type guard for {@link OAuthError}. */
export const IsOAuthError = (error: unknown): error is OAuthError => error instanceof OAuthError;
