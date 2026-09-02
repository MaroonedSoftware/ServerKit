import { ServerKitMiddleware } from '../../serverkit.middleware.js';
import { notFoundBody, renderError } from '@maroonedsoftware/servercore';

/**
 * Central error handler: catches thrown errors, sets status/body from HTTP errors,
 * returns 404 for unmatched routes, and 500 for unknown errors.
 * Emits `error` or `warn` on the app for logging.
 *
 * The status/body/headers split is `renderError` from `@maroonedsoftware/servercore`, shared
 * with every other adapter; this middleware only writes the result onto the Koa context.
 *
 * @returns {@link ServerKitMiddleware} that wraps the stack in try/catch and normalizes responses.
 */
export const errorMiddleware = (): ServerKitMiddleware => {
  return async (ctx, next) => {
    try {
      await next();
      if (ctx.status === 404 && !ctx.body) {
        const body = notFoundBody(ctx.URL.toString());
        ctx.status = 404;
        ctx.body = body;
        ctx.app.emit('warn', body, ctx);
      }
    } catch (error) {
      const rendered = renderError(error);
      ctx.status = rendered.status;
      ctx.body = rendered.body;
      if (rendered.headers) {
        for (const entry of Object.entries(rendered.headers)) {
          ctx.set(entry[0], entry[1]);
        }
      }

      ctx.app.emit('error', error, ctx);
    }
  };
};
