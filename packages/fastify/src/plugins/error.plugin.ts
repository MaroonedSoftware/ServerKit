import type { FastifyError, FastifyRequest } from 'fastify';
import { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { httpError, HttpStatusMap, IsServerkitError, type HttpStatusCodes } from '@maroonedsoftware/errors';
import { notFoundBody, renderError } from '@maroonedsoftware/servercore';
import { serverKitPlugin, type ServerKitPlugin } from '../serverkit.plugin.js';
import { requestPath } from '../request/request.accessors.js';

/** Narrows to an error Fastify itself raised (validation, body limit, unsupported media type, ...). */
const isFastifyError = (error: unknown): error is FastifyError => {
  return error instanceof Error && typeof (error as { code?: unknown }).code === 'string' && (error as FastifyError).code.startsWith('FST_');
};

/**
 * The request fields logged alongside an error or a synthesised 404. `path` has the query string
 * stripped, because it can carry credentials (tokens, signed-URL signatures) that must not reach
 * the logs. `requestId` is Fastify's own `request.id`, set before any hook runs, so it is present
 * even when the failure came before the context hook; `correlationId` is not.
 */
const requestLogMeta = (request: FastifyRequest, status: number): Record<string, unknown> => ({
  method: request.method,
  path: requestPath(request),
  status,
  requestId: request.id,
  correlationId: request.correlationId,
});

const isKnownStatus = (status: number): status is HttpStatusCodes => status in HttpStatusMap;

/**
 * Maps a Fastify-raised client error (4xx) to an `HttpError` so `renderError` renders it with
 * its status rather than as an opaque 500. Fastify's message (e.g. a validation failure) travels
 * under `details.reason`; nothing else from the error reaches the client. Server-side Fastify
 * errors and everything else pass through untouched, so ServerKit's own three-way rendering
 * contract still decides.
 */
export const normalizeFastifyError = (error: unknown): unknown => {
  if (IsServerkitError(error)) return error;
  if (
    isFastifyError(error) &&
    error.statusCode !== undefined &&
    error.statusCode >= 400 &&
    error.statusCode < 500 &&
    isKnownStatus(error.statusCode)
  ) {
    return httpError(error.statusCode).withCause(error).withDetails({ reason: error.message });
  }
  return error;
};

/**
 * Central error handling: renders thrown errors with ServerKit's status/body/headers rules and
 * synthesises the 404 body for unmatched routes, logging each through the request logger with
 * the request's method, path (never the query string), status, and request and correlation IDs.
 * A 4xx logs at `warn`, since it is the caller's fault; a 5xx logs at `error`.
 *
 * Installs Fastify's `setErrorHandler` and `setNotFoundHandler`. The status/body/headers split is
 * `renderError` from `@maroonedsoftware/servercore`, shared with every other adapter; a 4xx error
 * Fastify raised itself is first mapped to an `HttpError` (see {@link normalizeFastifyError}).
 * A validation error from `@maroonedsoftware/fastify/zod` is already an `HttpError`, so it renders
 * with its own details.
 *
 * Register it **first**, before {@link serverKitContextPlugin}.
 *
 * @param container - Root container, used to resolve the {@link Logger} when a request failed
 *   before its own scoped logger existed.
 * @returns A {@link ServerKitPlugin} that installs both handlers.
 */
export const errorPlugin = (container: Container): ServerKitPlugin => {
  return serverKitPlugin('serverkit.error', async app => {
    // `request.logger` is declared non-optional but is only populated once the context hook has
    // run; an error thrown before that (or in the hook itself) falls back to the root logger.
    const loggerFor = (logger: Logger | undefined): Logger => logger ?? container.get(Logger);

    app.setErrorHandler(async (error: unknown, request, reply) => {
      const rendered = renderError(normalizeFastifyError(error));
      // A 4xx is the caller's fault, not the server's, so it logs at warn.
      const logger = loggerFor(request.logger);
      const meta = requestLogMeta(request, rendered.status);
      if (rendered.status < 500) {
        logger.warn(error, meta);
      } else {
        logger.error(error, meta);
      }
      return reply
        .headers(rendered.headers ?? {})
        .status(rendered.status)
        .send(rendered.body);
    });

    app.setNotFoundHandler(async (request, reply) => {
      const origin = `${request.protocol}://${request.host}`;
      const body = notFoundBody(`${origin}${request.url ?? ''}`);
      // The logged copy drops the query string, which can carry credentials; the client still gets the full URL.
      loggerFor(request.logger).warn(notFoundBody(`${origin}${requestPath(request)}`), requestLogMeta(request, 404));
      return reply.status(404).send(body);
    });
  });
};
