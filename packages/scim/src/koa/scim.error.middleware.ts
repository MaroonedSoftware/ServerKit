import type { ServerKitMiddleware } from '@maroonedsoftware/koa';
import { SCIM_MEDIA_TYPE } from '../scim.media.type.js';
import { renderScimError, scimNotFoundBody } from '../http/scim.error.render.js';

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
        ctx.status = 404;
        ctx.type = SCIM_MEDIA_TYPE;
        ctx.body = scimNotFoundBody(ctx.URL.pathname);
      }
    } catch (error) {
      const rendered = renderScimError(error);
      ctx.status = rendered.status;
      ctx.type = SCIM_MEDIA_TYPE;
      ctx.body = rendered.body;
      for (const [name, value] of Object.entries(rendered.headers)) {
        ctx.set(name, value);
      }
      ctx.app.emit('error', error, ctx);
    }
  };
};
