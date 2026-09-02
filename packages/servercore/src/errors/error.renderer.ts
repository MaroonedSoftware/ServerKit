import { IsHttpError, IsServerkitError } from '@maroonedsoftware/errors';

/** The wire shape of every error body ServerKit renders. */
export interface RenderedErrorBody {
  statusCode: number;
  message: string;
  details?: unknown;
}

/** An error rendered to its HTTP status, body, and any headers the error asked to set. */
export interface RenderedError {
  status: number;
  body: RenderedErrorBody;
  headers?: Record<string, string>;
}

/**
 * Maps a thrown value to the response ServerKit sends for it. This is a data-exposure boundary
 * shared by every HTTP adapter, and the split is deliberate:
 *
 * - An `HttpError` renders its own status, message, and `details`, plus any `headers` it carries.
 * - A bare `ServerkitError` renders a **500 with its `details`** (the message is still its own).
 * - Anything else renders a generic 500 with **no** `details` key at all.
 *
 * `internalDetails` never reach the body in any branch. Changing which payload reaches the
 * client is a security change; keep the adapters calling this rather than re-deriving it.
 *
 * @param error - The thrown value.
 * @returns The status, body, and optional headers to send.
 */
export const renderError = (error: unknown): RenderedError => {
  if (IsHttpError(error)) {
    return {
      status: error.statusCode,
      body: {
        statusCode: error.statusCode,
        message: error.message,
        details: error.details,
      },
      headers: error.headers,
    };
  }

  if (IsServerkitError(error)) {
    return {
      status: 500,
      body: {
        statusCode: 500,
        message: error.message,
        details: error.details,
      },
    };
  }

  return {
    status: 500,
    body: {
      statusCode: 500,
      message: 'Internal Server Error',
    },
  };
};

/**
 * The body ServerKit synthesises for an unmatched route.
 *
 * @param url - The requested URL, echoed under `details.url`.
 * @returns The 404 body.
 */
export const notFoundBody = (url: string): RenderedErrorBody => ({
  statusCode: 404,
  message: 'Not Found',
  details: { url },
});
