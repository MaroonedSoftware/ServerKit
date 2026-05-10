import { HttpError, HttpStatusCodes, type HttpStatusMessage } from '@maroonedsoftware/errors';

/** Schema URI for the SCIM Error message. */
export const ScimErrorSchema = 'urn:ietf:params:scim:api:messages:2.0:Error';

/**
 * `scimType` values defined by RFC 7644 §3.12 plus the few extensions clients
 * commonly emit. Keep this open as `string` to allow vendor-specific values.
 */
export type ScimErrorType =
  | 'invalidFilter'
  | 'tooMany'
  | 'uniqueness'
  | 'mutability'
  | 'invalidSyntax'
  | 'invalidPath'
  | 'noTarget'
  | 'invalidValue'
  | 'invalidVers'
  | 'sensitive'
  | 'insufficientScope'
  | (string & {});

/**
 * SCIM error envelope (RFC 7644 §3.12). The HTTP status comes from
 * the underlying {@link HttpError}; the JSON body matches:
 *
 * ```json
 * { "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"], "status": "404", "scimType": "invalidPath", "detail": "..." }
 * ```
 */
export class ScimError extends HttpError {
  /** SCIM-specific error subtype, see RFC 7644 §3.12. */
  readonly scimType?: ScimErrorType;

  constructor(statusCode: HttpStatusCodes, scimType?: ScimErrorType, message?: HttpStatusMessage<HttpStatusCodes>) {
    super(statusCode, message);
    this.scimType = scimType;
    Object.setPrototypeOf(this, ScimError.prototype);
  }

  /** Build the SCIM error JSON body for this error. */
  toScimBody(): { schemas: [typeof ScimErrorSchema]; status: string; scimType?: ScimErrorType; detail?: string } {
    return {
      schemas: [ScimErrorSchema],
      status: String(this.statusCode),
      ...(this.scimType ? { scimType: this.scimType } : {}),
      detail: this.message,
    };
  }
}

/** Type guard for {@link ScimError}. */
export const IsScimError = (error: unknown): error is ScimError => error instanceof ScimError;

/**
 * Factory for building a SCIM-shaped HTTP error. The returned object behaves like
 * an {@link HttpError}, so chained `.withDetails()` / `.withCause()` /
 * `.withInternalDetails()` work as usual.
 *
 * @example
 * ```ts
 * throw scimError(400, 'invalidFilter', 'Bad Request');
 * ```
 */
export const scimError = <Status extends HttpStatusCodes>(
  statusCode: Status,
  scimType?: ScimErrorType,
  message?: HttpStatusMessage<Status>,
): ScimError => new ScimError(statusCode, scimType, message);
