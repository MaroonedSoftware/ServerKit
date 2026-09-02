import type { FastifyError } from 'fastify';
import { Container } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { httpError, HttpStatusMap, IsServerkitError, type HttpStatusCodes } from '@maroonedsoftware/errors';
import { notFoundBody, renderError } from '@maroonedsoftware/servercore';
import { ServerKitMiddleware } from '../../serverkit.middleware.js';

/** Narrows to an error Fastify itself raised (validation, body limit, unsupported media type, ...). */
const isFastifyError = (error: unknown): error is FastifyError => {
  return error instanceof Error && typeof (error as { code?: unknown }).code === 'string' && (error as FastifyError).code.startsWith('FST_');
};

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
 * synthesises the 404 body for unmatched routes, logging each through the request logger.
 *
 * Installs Fastify's `setErrorHandler` and `setNotFoundHandler`. The status/body/headers split is
 * `renderError` from `@maroonedsoftware/servercore`, shared with every other adapter; a 4xx
 * error Fastify raised itself is first mapped to an `HttpError` (see
 * {@link normalizeFastifyError}). Register it **first**, before `serverKitContextMiddleware`.
 *
 * @param container - Root container, used to resolve the {@link Logger} when a request failed
 *   before its own scoped logger existed.
 * @returns {@link ServerKitMiddleware} that installs both handlers.
 */
export const errorMiddleware = (container: Container): ServerKitMiddleware => {
  return app => {
    // `request.logger` is declared non-optional but is only populated once the context hook has
    // run; an error thrown before that (or in the hook itself) falls back to the root logger.
    const loggerFor = (logger: Logger | undefined): Logger => logger ?? container.get(Logger);

    app.setErrorHandler((error: unknown, request, reply) => {
      const rendered = renderError(normalizeFastifyError(error));
      loggerFor(request.logger).error(error);
      void reply
        .headers(rendered.headers ?? {})
        .status(rendered.status)
        .send(rendered.body);
    });

    app.setNotFoundHandler((request, reply) => {
      const body = notFoundBody(`${request.protocol}://${request.host}${request.url ?? ''}`);
      loggerFor(request.logger).warn(body);
      void reply.status(404).send(body);
    });
  };
};
