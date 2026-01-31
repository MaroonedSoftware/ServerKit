import coBody from 'co-body';
import { httpError, IsHttpError } from '@maroonedsoftware/errors';
import { MultipartBody } from '@maroonedsoftware/multipart';
import rawBody from 'raw-body';
import { ServerKitMiddleware } from '../../serverkit.middleware.js';

/**
 * Parses the request body based on `Content-Type` and assigns it to `ctx.body`.
 * Rejects requests with unexpected or unsupported content types.
 *
 * Supported types: JSON, URL-encoded form, text, multipart, PDF (raw buffer).
 * Requires a body when `contentTypes` is non-empty; otherwise rejects bodies.
 *
 * @param contentTypes - Allowed MIME types (e.g. `['application/json', 'application/x-www-form-urlencoded']`).
 *   Use an empty array to disallow any request body.
 * @returns {@link ServerKitMiddleware} that parses the body and sets `ctx.body`.
 * @throws HTTP 400 if body is present when no content types are allowed.
 * @throws HTTP 411 if body is required but missing.
 * @throws HTTP 415 if `Content-Type` is not in `contentTypes`.
 * @throws HTTP 422 if body is invalid or media type is unsupported.
 */
export const bodyParserMiddleware = (contentTypes: string[]): ServerKitMiddleware => {
  return async (ctx, next) => {
    if (contentTypes.length === 0) {
      if (ctx.request.length > 0) {
        throw httpError(400).withDetails({ body: 'Unexpected body' });
      }
    } else {
      if (ctx.request.length > 0) {
        if (!ctx.request.is(contentTypes)) {
          throw httpError(415).withDetails({
            'content-type': `must be ${contentTypes.length > 1 ? 'one of ' : ''}${contentTypes.join(', ')}`,
            value: ctx.request.type,
          });
        }

        try {
          if (ctx.request.is('json', 'application/*+json')) {
            ctx.body = await coBody.json(ctx);
          } else if (ctx.request.is('urlencoded')) {
            ctx.body = await coBody.form(ctx);
          } else if (ctx.request.is('text/*')) {
            ctx.body = await coBody.text(ctx);
          } else if (ctx.request.is('multipart')) {
            ctx.body = new MultipartBody(ctx.req);
          } else if (ctx.request.is('pdf')) {
            ctx.body = await rawBody(ctx.req);
          } else {
            throw httpError(422).withDetails({ body: 'Unsupported media type' });
          }
        } catch (error) {
          if (IsHttpError(error)) {
            throw error;
          }
          throw httpError(422)
            .withCause(error as Error)
            .withDetails({ body: 'Invalid request body format' });
        }
      } else {
        throw httpError(411);
      }
    }
    await next();
  };
};
