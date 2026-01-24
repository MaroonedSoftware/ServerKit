import { ServerKitMiddleware } from '../../serverkit.middleware.js';
import { IsHttpError } from '@maroonedsoftware/errors';

export const errorMiddleware = (): ServerKitMiddleware => {
  return async (ctx, next) => {
    try {
      await next();
      if (ctx.status === 404 && !ctx.body) {
        const body = {
          statusCode: 404,
          message: 'Not Found',
          details: { url: ctx.URL.toString() },
        };
        ctx.status = 404;
        ctx.body = body;
        ctx.app.emit('warn', body, ctx);
      }
    } catch (error) {
      if (IsHttpError(error)) {
        ctx.status = error.statusCode;
        ctx.body = {
          statusCode: error.statusCode,
          message: error.message,
          details: error.details,
        };
        if (error.headers) {
          for (const entry of Object.entries(error.headers)) {
            ctx.set(entry[0], entry[1]);
          }
        }
      } else {
        ctx.status = 500;
        ctx.body = {
          statusCode: 500,
          message: 'Internal Server Error',
        };
      }

      ctx.app.emit('error', error, ctx);
    }
  };
};
