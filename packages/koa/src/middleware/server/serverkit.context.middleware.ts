import crypto from 'crypto';
import { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitMiddleware } from '../../serverkit.middleware.js';

/**
 * Populates {@link ServerKitContext} for each request: scoped container, logger,
 * logger name, user-agent, correlation ID, and request ID.
 * Reads or generates `X-Correlation-Id` and `X-Request-Id` and sets response headers.
 * Should be applied early so downstream middleware and routes can use `ctx.container` and `ctx.logger`.
 *
 * @param container - Root injectkit {@link Container} used to create a scoped container and resolve {@link Logger}.
 * @returns {@link ServerKitMiddleware} that attaches ServerKit context to `ctx`.
 */
export const serverKitContextMiddleware = (container: Container): ServerKitMiddleware => {
  return async (ctx, next) => {
    ctx.container = container.createScopedContainer();
    ctx.logger = container.get(Logger);
    ctx.loggerName = ctx.path;

    ctx.userAgent = ctx.get('user-agent');
    ctx.ipAddress = ctx.ip;

    const correlationId = ctx.headers['x-correlation-id'];
    ctx.correlationId = Array.isArray(correlationId) ? (correlationId[0] ?? crypto.randomUUID()) : (correlationId ?? crypto.randomUUID());

    ctx.requestId = crypto.randomUUID();

    ctx.headers['x-correlation-id'] = ctx.correlationId;
    ctx.set('x-correlation-id', ctx.correlationId);

    ctx.headers['x-request-id'] = ctx.requestId;
    ctx.set('x-request-id', ctx.requestId);

    await next();
  };
};
