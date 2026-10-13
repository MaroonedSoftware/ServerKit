import { IsHttpError, IsServerkitError } from '@maroonedsoftware/errors';
import { IsScimError, ScimError, ScimErrorSchema } from '../errors/scim.error.js';

/** The SCIM error envelope (RFC 7644 §3.12) as it goes on the wire. */
export interface ScimErrorBody {
  schemas: [typeof ScimErrorSchema];
  status: string;
  scimType?: string;
  detail?: string;
}

/** A rendered SCIM error: what a transport writes to the response. */
export interface RenderedScimError {
  status: number;
  headers: Record<string, string>;
  body: ScimErrorBody;
}

/**
 * Render any thrown value as a SCIM error response. Shared by every transport so the envelope
 * is identical whichever framework mounts the endpoints:
 *
 * - a {@link ScimError} renders as itself, headers included;
 * - any other `HttpError` keeps its status and details, wrapped in a `ScimError`;
 * - anything else is a 500, with the message only when it is a `ServerkitError`.
 */
export const renderScimError = (error: unknown): RenderedScimError => {
  if (IsScimError(error)) {
    return { status: error.statusCode, headers: { ...(error.headers ?? {}) }, body: error.toScimBody() };
  }
  if (IsHttpError(error)) {
    return renderScimError(new ScimError(error.statusCode).withDetails(error.details ?? {}).withCause(error));
  }
  const status = 500;
  return {
    status,
    headers: {},
    body: { schemas: [ScimErrorSchema], status: String(status), detail: IsServerkitError(error) ? error.message : 'Internal Server Error' },
  };
};

/** The SCIM envelope for a path no SCIM endpoint matched. */
export const scimNotFoundBody = (pathname: string): ScimErrorBody => ({
  schemas: [ScimErrorSchema],
  status: '404',
  detail: `Not Found: ${pathname}`,
});
