import { Context } from 'koa';
import { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';

/**
 * Koa context extended with ServerKit request-scoped services and metadata.
 * Populated by {@link serverKitContextMiddleware}.
 * Use this as the context type for route handlers to get full typing of `ctx.container`, `ctx.logger`, and request IDs.
 *
 * @extends Context
 * @see {@link serverKitContextMiddleware} – middleware that populates this context on each request
 */
export interface ServerKitContext extends Context {
  /** Scoped injectkit container for this request; use for request-scoped DI. */
  container: Container;
  /** Request-scoped logger instance. */
  logger: Logger;
  /** Logger name for this request (e.g. request path or route identifier). */
  loggerName: string;
  /** Value of the `User-Agent` request header, or empty string if absent. */
  userAgent: string;
  /** Correlation ID for tracing; from `X-Correlation-Id` header or generated. */
  correlationId: string;
  /** Request ID; from `X-Request-Id` header or generated. */
  requestId: string;
  /** Raw body for this request. */
  rawBody: unknown;
}
