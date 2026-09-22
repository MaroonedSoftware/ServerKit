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
        ctx.status = 404;
        ctx.body = notFoundBody(ctx.URL.toString());
        // The emitted copy is logged, so it drops the query string, which can carry credentials.
        const logged = new URL(ctx.URL);
        logged.search = '';
        ctx.app.emit('warn', notFoundBody(logged.toString()), ctx);
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
