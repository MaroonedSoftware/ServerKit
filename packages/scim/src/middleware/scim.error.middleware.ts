import type { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { IsHttpError, IsServerkitError } from '@maroonedsoftware/errors';
import { IsScimError, ScimError, ScimErrorSchema } from '../errors/scim.error.js';
import { SCIM_MEDIA_TYPE } from './scim.content.type.middleware.js';

/**
 * SCIM-shaped error middleware. Catches errors thrown by downstream handlers
 * and renders them as the RFC 7644 §3.12 envelope with `Content-Type:
 * application/scim+json`.
 *
 * Mount this *inside* a SCIM sub-router (or in front of the SCIM router on
 * its own Koa instance) — do not replace the application-wide
 * `errorMiddleware` from `@maroonedsoftware/koa` with it.
 */
export const scimErrorMiddleware = (): ServerKitMiddleware => {
  return async (ctx, next) => {
    try {
      await next();
      if (ctx.status === 404 && !ctx.body) {
        const status = 404;
        ctx.status = status;
        ctx.type = SCIM_MEDIA_TYPE;
        ctx.body = {
          schemas: [ScimErrorSchema],
          status: String(status),
          detail: `Not Found: ${ctx.URL.pathname}`,
        };
      }
    } catch (error) {
      if (IsScimError(error)) {
        respondWithScimError(ctx, error);
        ctx.app.emit('error', error, ctx);
        return;
      }
      if (IsHttpError(error)) {
        respondWithScimError(ctx, new ScimError(error.statusCode).withDetails(error.details ?? {}).withCause(error));
        ctx.app.emit('error', error, ctx);
        return;
      }
      const status = 500;
      const detail = IsServerkitError(error) ? error.message : 'Internal Server Error';
      ctx.status = status;
      ctx.type = SCIM_MEDIA_TYPE;
      ctx.body = {
        schemas: [ScimErrorSchema],
        status: String(status),
        detail,
      };
      ctx.app.emit('error', error, ctx);
    }
  };
};

const respondWithScimError = (ctx: Parameters<ServerKitMiddleware>[0], error: ScimError): void => {
  ctx.status = error.statusCode;
  ctx.type = SCIM_MEDIA_TYPE;
  ctx.body = error.toScimBody();
  if (error.headers) {
    for (const [name, value] of Object.entries(error.headers)) {
      ctx.set(name, value);
    }
  }
};
