import { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { resolveRequestIdentity } from '@maroonedsoftware/servercore';
import { ServerKitMiddleware } from '../../serverkit.middleware.js';
import { ServerKitContext } from '../../serverkit.context.js';

/**
 * Populates {@link ServerKitContext} for each request: scoped container, logger,
 * logger name, user-agent, correlation ID, and request ID.
 * Reads or generates `X-Correlation-Id` and `X-Request-Id` and sets response headers.
 * Registers the live `ctx` against the {@link ServerKitContext} injection token in the
 * request-scoped container so downstream services can inject the current context.
 * Should be applied early so downstream middleware and routes can use `ctx.container` and `ctx.logger`.
 *
 * The scoped container is disposed when the response closes (after the body is flushed, or when
 * an aborted/streaming socket ends), releasing any scoped services that implement a dispose
 * protocol. Resolving from `ctx.container` after the response has closed throws.
 *
 * @param container - Root injectkit {@link Container} used to create a scoped container and resolve {@link Logger}.
 * @returns {@link ServerKitMiddleware} that attaches ServerKit context to `ctx`.
 */
export const serverKitContextMiddleware = (container: Container): ServerKitMiddleware => {
  return async (ctx, next) => {
    const scopedContainer = container.createScopedContainer();
    ctx.container = scopedContainer;

    scopedContainer.override(ServerKitContext, ctx);

    ctx.logger = ctx.container.get(Logger);
    ctx.loggerName = ctx.path;

    // Dispose when the response closes, not after next(): SSE/serverfeed handlers return
    // while the socket stays open (ctx.respond = false; see sse.stream.ts), so their scoped
    // services must outlive next(). 'close' fires exactly once per response — after 'finish'
    // on a normal response, immediately on an aborted one — and keep-alive reuses the socket
    // but not the ServerResponse, so scopes cannot leak across requests. After disposal,
    // resolving from ctx.container throws; resolve dependencies before responding.
    ctx.res.once('close', () => {
      // Log rather than rethrow: the response is already gone, so a disposal failure has no
      // request to fail (same shape as the pgboss job runner's scope teardown).
      void scopedContainer.disposeAsync().catch((error: unknown) => ctx.logger.error(error));
    });

    ctx.userAgent = ctx.get('user-agent');
    ctx.ipAddress = ctx.ip;

    const { correlationId, requestId } = resolveRequestIdentity(ctx.headers);
    ctx.correlationId = correlationId;
    ctx.requestId = requestId;

    ctx.headers['x-correlation-id'] = ctx.correlationId;
    ctx.set('x-correlation-id', ctx.correlationId);

    ctx.headers['x-request-id'] = ctx.requestId;
    ctx.set('x-request-id', ctx.requestId);

    await next();
  };
};
