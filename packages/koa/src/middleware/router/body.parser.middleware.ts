import coBody from 'co-body';
import { httpError, IsHttpError } from '@maroonedsoftware/errors';
import { MultipartBody } from '@maroonedsoftware/multipart';
import rawBody from 'raw-body';
import { ServerKitMiddleware } from '../../serverkit.middleware.js';

export const bodyParserMiddleware = (contentTypes: string[]): ServerKitMiddleware => {
  return async (ctx, next) => {
    if (contentTypes.length === 0) {
      if (ctx.request.length > 0) {
        throw httpError(400).withErrors({ body: 'Unexpected body' });
      }
    } else {
      if (ctx.request.length > 0) {
        if (!ctx.request.is(contentTypes)) {
          throw httpError(415).withErrors({
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
            throw httpError(422).withErrors({ body: 'Unsupported media type' });
          }
        } catch (error) {
          if (IsHttpError(error)) {
            throw error;
          }
          throw httpError(422)
            .withCause(error as Error)
            .withErrors({ body: 'Invalid request body format' });
        }
      } else {
        throw httpError(411);
      }
    }
    await next();
  };
};
