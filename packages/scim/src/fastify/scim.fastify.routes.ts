import type { FastifyError, FastifyInstance, FastifyPluginAsync, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type {} from '@maroonedsoftware/fastify';
import { httpError, HttpStatusMap, IsServerkitError, type HttpStatusCodes } from '@maroonedsoftware/errors';
import type { Logger } from '@maroonedsoftware/logger';
import { SCIM_MEDIA_TYPE } from '../scim.media.type.js';
import { createScimRouteTable, scimServicesFrom, type ScimEndpointOptions, type ScimServices } from '../http/scim.endpoints.js';
import { ScimUserService } from '../services/scim.user.service.js';
import { ScimGroupService } from '../services/scim.group.service.js';
import { ScimServiceProviderService } from '../services/scim.service.provider.service.js';
import { renderScimError, scimNotFoundBody } from '../http/scim.error.render.js';

/**
 * Options for {@link scimRoutes}. The caller either constructs the three services (wiring them to
 * their backing repositories and a logger) and hands them in, or passes `resolveServices`, called
 * with each request (see {@link fromRequestContainer}).
 */
export type ScimRoutesOptions = ScimEndpointOptions<FastifyRequest> & {
  /** Optional `preHandler` hooks run on every route (e.g. `requireScimScope('scim')`). */
  routeGuards?: preHandlerAsyncHookHandler[];
};

/**
 * A `resolveServices` for {@link scimRoutes} that takes the three SCIM services from the request's
 * scoped container (`request.container`, set by `serverKitContextPlugin`). Register
 * `ScimUserService`, `ScimGroupService` and `ScimServiceProviderService`, with your repositories
 * request-scoped, so each request's repositories see its own transaction or tenant.
 *
 * @param request - The request being answered.
 * @returns The services resolved from the request's container.
 */
export const fromRequestContainer = (request: FastifyRequest): ScimServices => ({
  userService: request.container.get(ScimUserService),
  groupService: request.container.get(ScimGroupService),
  serviceProviderService: request.container.get(ScimServiceProviderService),
});

/** Content types the body-carrying SCIM routes accept. RFC 7644 §3.8 also allows plain JSON. */
const SCIM_BODY_TYPES = [SCIM_MEDIA_TYPE, 'application/json'];

const isKnownStatus = (status: number): status is HttpStatusCodes => status in HttpStatusMap;

/** Narrows to an error Fastify itself raised (bad JSON, unsupported media type, body limit, ...). */
const isFastifyError = (error: unknown): error is FastifyError =>
  error instanceof Error && typeof (error as { code?: unknown }).code === 'string' && (error as FastifyError).code.startsWith('FST_');

/**
 * Map a Fastify-raised client error (4xx) to an `HttpError`, so it renders as a SCIM envelope
 * with its own status rather than as a 500. Fastify's message travels as the envelope `detail`.
 */
const normalizeError = (error: unknown): unknown => {
  if (IsServerkitError(error)) return error;
  if (
    isFastifyError(error) &&
    error.statusCode !== undefined &&
    error.statusCode >= 400 &&
    error.statusCode < 500 &&
    isKnownStatus(error.statusCode)
  ) {
    return httpError(error.statusCode).withCause(error).withDetails({ message: error.message });
  }
  return error;
};

/** The request path without its query string, which can carry credentials. */
const requestPathname = (request: FastifyRequest): string => request.url.split('?')[0] ?? request.url;

/**
 * Log a failed SCIM request: `warn` for a 4xx, which is the caller's fault, `error` for a 5xx.
 * Uses ServerKit's request logger when `serverKitContextPlugin` set one, Fastify's own otherwise.
 */
const logFailure = (request: FastifyRequest, error: unknown, status: number): void => {
  const meta = { method: request.method, path: requestPathname(request), status, requestId: request.id };
  const logger = request.logger as Logger | undefined;
  if (logger) {
    if (status < 500) logger.warn(error, meta);
    else logger.error(error, meta);
    return;
  }
  if (status < 500) request.log.warn({ err: error, ...meta }, 'SCIM request failed');
  else request.log.error({ err: error, ...meta }, 'SCIM request failed');
};

/**
 * Build a Fastify plugin serving the SCIM 2.0 endpoints (RFC 7644 §3.4), with the same routes and
 * semantics as `createScimRouter` from `@maroonedsoftware/scim/koa`:
 *
 * - `GET|POST /Users`, `GET|PUT|PATCH|DELETE /Users/:id`, `POST /Users/.search`
 * - the same for `/Groups`
 * - `GET /ServiceProviderConfig`, `/Schemas`, `/Schemas/:id`, `/ResourceTypes`, `/ResourceTypes/:id`
 *
 * The plugin is encapsulated (not `fastify-plugin`-wrapped), so everything it installs applies to
 * the SCIM routes only:
 *
 * - **Errors** render as the RFC 7644 §3.12 envelope with `Content-Type: application/scim+json`,
 *   through a scoped `setErrorHandler`. A `ScimError` renders as itself, any other `HttpError`
 *   keeps its status and details, and anything else is a 500.
 * - **Unmatched paths** under a prefix get a SCIM 404 envelope from a scoped `setNotFoundHandler`.
 *   Without a prefix the app's own not-found handler stays in charge, since Fastify allows one per prefix.
 * - **Bodies**: body-carrying routes declare `config.body` as `application/scim+json` and
 *   `application/json`, which is what `bodyParserPlugin` from `@maroonedsoftware/fastify` gates on;
 *   its default parser mappings already read `application/*+json`. On a plain Fastify instance
 *   (Fastify's own JSON parser still installed) the plugin registers its JSON parser for
 *   `application/scim+json` within its scope.
 *
 * Register it after the ServerKit stack (`serverKitContextPlugin`, `authenticationPlugin`), so
 * guards see `request.authenticationSession`. Mount it under a prefix (`{ plugin, prefix }` in
 * `ServerKitServerBuilder.setupRoutes`, or `app.register(plugin, { prefix })`) and set `baseUrl`
 * to match.
 *
 * @param options - Services, guards, paging cap, and `baseUrl`.
 * @returns An encapsulated Fastify plugin.
 *
 * @example
 * ```typescript
 * import { requireScimScope, scimRoutes } from '@maroonedsoftware/scim/fastify';
 *
 * builder.setupRoutes([
 *   {
 *     prefix: '/scim/v2',
 *     plugin: scimRoutes({
 *       userService,
 *       groupService,
 *       serviceProviderService,
 *       routeGuards: [requireScimScope('scim')],
 *       baseUrl: 'https://api.example.com/scim/v2',
 *     }),
 *   },
 * ]);
 * ```
 */
export const scimRoutes = (options: ScimRoutesOptions): FastifyPluginAsync => {
  const routes = createScimRouteTable(options);
  const servicesFor = scimServicesFrom(options);
  const guards = options.routeGuards ?? [];

  return async (app: FastifyInstance): Promise<void> => {
    // Fastify's built-in JSON parser present means ServerKit's catch-all is not, so nothing would
    // read `application/scim+json`. Under ServerKit, leave its dispatcher (and its limits) in charge.
    if (app.hasContentTypeParser('application/json') && !app.hasContentTypeParser(SCIM_MEDIA_TYPE)) {
      app.addContentTypeParser(SCIM_MEDIA_TYPE, { parseAs: 'string' }, app.getDefaultJsonParser('error', 'error'));
    }

    app.setErrorHandler(async (error: unknown, request, reply) => {
      const rendered = renderScimError(normalizeError(error));
      logFailure(request, error, rendered.status);
      return reply.headers(rendered.headers).status(rendered.status).type(SCIM_MEDIA_TYPE).send(rendered.body);
    });

    if (app.prefix) {
      app.setNotFoundHandler(async (request, reply) => {
        return reply
          .status(404)
          .type(SCIM_MEDIA_TYPE)
          .send(scimNotFoundBody(requestPathname(request)));
      });
    }

    for (const route of routes) {
      app.route({
        method: route.method,
        url: route.path,
        preHandler: guards,
        config: route.body ? { body: SCIM_BODY_TYPES } : {},
        handler: async (request, reply) => {
          const response = await route.handler({
            params: request.params as Record<string, string | undefined>,
            query: request.query as Record<string, unknown>,
            body: request.body,
            services: await servicesFor(request),
          });
          if (response.location) reply.header('Location', response.location);
          reply.status(response.status);
          if (response.body === undefined) return reply.send();
          return reply.type(SCIM_MEDIA_TYPE).send(response.body);
        },
      });
    }
  };
};
