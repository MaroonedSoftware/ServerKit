import type { FastifyReply, FastifyRequest } from 'fastify';
import { Container, Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { AuthenticationSession } from '@maroonedsoftware/authentication';
import { BinaryLike } from 'node:crypto';

declare module 'fastify' {
  /** Per-route configuration ServerKit reads, merged into Fastify's own route `config`. */
  interface FastifyContextConfig {
    /**
     * Content types this route accepts a body for, e.g. `['application/json']`. Read by
     * `bodyParserPlugin`, which parses a matching body into `request.body`. A route without it
     * accepts no body, and a request that sends one is rejected with 400.
     */
    body?: string[];
  }

  /**
   * Fastify's request, extended with ServerKit's request-scoped services and metadata.
   * Populated by `serverKitContextPlugin` on every request; the fields are declared as
   * request decorators so they exist on every request object with a stable shape.
   */
  interface FastifyRequest {
    /** Scoped injectkit container for this request; use for request-scoped DI. */
    container: Container;
    /** Request-scoped logger instance. */
    logger: Logger;
    /** Logger name for this request (the request path). */
    loggerName: string;
    /** Value of the `User-Agent` request header, or empty string if absent. */
    userAgent: string;
    /** IP address of the client. */
    ipAddress: string;
    /** Correlation ID for tracing; from `X-Correlation-Id` header or generated. */
    correlationId: string;
    /** Request ID; from `X-Request-Id` header or generated. */
    requestId: string;
    /**
     * Raw request body bytes, captured by `bodyParserPlugin` alongside the parsed value on
     * `request.body`. Needed by `requireSignature`, which hashes the bytes as they arrived.
     */
    rawBody: BinaryLike;
    /** Authentication session, populated by `authenticationPlugin`. */
    authenticationSession: AuthenticationSession;
    /** The reply paired with this request, so an injected context can set response headers. */
    reply: FastifyReply;
  }
}

/**
 * The ServerKit request context on Fastify: the request itself, carrying the request-scoped
 * container, logger, IDs, raw body, and authentication session declared above.
 *
 * Route handlers receive `(request, reply)`; `request` is this type. Services can also declare
 * `ServerKitContext` as a constructor dependency and receive the live request, because
 * `serverKitContextMiddleware` registers it against this token in the request scope.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging, @typescript-eslint/no-empty-object-type, @typescript-eslint/no-empty-interface
export interface ServerKitContext extends FastifyRequest {}

/**
 * Abstract class merged with the {@link ServerKitContext} interface so it can serve as an
 * injectkit injection token, like `Logger` and `JobContext`. Do not split it.
 */
@Injectable()
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export abstract class ServerKitContext implements ServerKitContext {}
