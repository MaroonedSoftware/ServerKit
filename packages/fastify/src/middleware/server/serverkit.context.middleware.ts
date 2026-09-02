import { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { CORRELATION_ID_HEADER, REQUEST_ID_HEADER, resolveRequestIdentity } from '@maroonedsoftware/servercore';
import { ServerKitMiddleware } from '../../serverkit.middleware.js';
import { ServerKitContext } from '../../serverkit.context.js';
import { requestPath } from '../../serverkit.request.js';

/** Every field {@link serverKitContextMiddleware} populates, declared up front as request decorators. */
const CONTEXT_FIELDS = [
  'container',
  'logger',
  'loggerName',
  'userAgent',
  'ipAddress',
  'correlationId',
  'requestId',
  'rawBody',
  'parsedBody',
  'authenticationSession',
  'reply',
] as const;

/**
 * Populates the ServerKit request context for each request: scoped container, logger,
 * logger name, user-agent, correlation ID, and request ID.
 * Reads or generates `X-Correlation-Id` and `X-Request-Id` and sets response headers.
 * Registers the live request against the {@link ServerKitContext} injection token in the
 * request-scoped container so downstream services can inject the current context.
 *
 * Installs an `onRequest` hook, so it runs before body parsing, routing guards, and handlers.
 * Register it second, right after `errorMiddleware`, so every later hook can use
 * `request.container` and `request.logger`.
 *
 * The scoped container is disposed when the raw response closes (after the body is flushed, or
 * when an aborted or hijacked socket ends), not in `onResponse`, so an SSE handler that hijacks
 * the reply keeps its scoped services for as long as the socket lives. Resolving from
 * `request.container` after the response has closed throws.
 *
 * @param container - Root injectkit {@link Container} used to create a scoped container and resolve {@link Logger}.
 * @returns {@link ServerKitMiddleware} that decorates the request and installs the hook.
 */
export const serverKitContextMiddleware = (container: Container): ServerKitMiddleware => {
  return app => {
    // Declared without a value: Fastify forbids reference-type defaults on request decorators
    // (they would be shared across requests), and declaring the keys keeps the request's
    // hidden class stable.
    for (const field of CONTEXT_FIELDS) {
      app.decorateRequest(field);
    }

    app.addHook('onRequest', async (request, reply) => {
      const scopedContainer = container.createScopedContainer();
      request.container = scopedContainer;
      request.reply = reply;

      scopedContainer.override(ServerKitContext, request);

      request.logger = request.container.get(Logger);
      request.loggerName = requestPath(request);

      // Dispose when the raw response closes, not in onResponse: an SSE handler hijacks the reply
      // and returns while the socket stays open, so its scoped services must outlive the handler.
      // 'close' fires exactly once per response, and keep-alive reuses the socket but not the
      // ServerResponse, so scopes cannot leak across requests.
      reply.raw.once('close', () => {
        // Log rather than rethrow: the response is already gone, so a disposal failure has no
        // request to fail.
        void scopedContainer.disposeAsync().catch((error: unknown) => request.logger.error(error));
      });

      request.userAgent = request.headers['user-agent'] ?? '';
      request.ipAddress = request.ip;

      const { correlationId, requestId } = resolveRequestIdentity(request.headers);
      request.correlationId = correlationId;
      request.requestId = requestId;

      request.headers[CORRELATION_ID_HEADER] = correlationId;
      request.headers[REQUEST_ID_HEADER] = requestId;
      void reply.header(CORRELATION_ID_HEADER, correlationId).header(REQUEST_ID_HEADER, requestId);
    });
  };
};
