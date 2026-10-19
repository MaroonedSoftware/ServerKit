import type { ServerKitContext, ServerKitRouterMiddleware } from '@maroonedsoftware/koa';
import { bodyParserMiddleware, ServerKitRouter } from '@maroonedsoftware/koa';
import type Router from '@koa/router';
import { SCIM_MEDIA_TYPE } from '../scim.media.type.js';
import { createScimRouteTable, scimServicesFrom, type ScimEndpointOptions, type ScimServices } from '../http/scim.endpoints.js';
import { ScimUserService } from '../services/scim.user.service.js';
import { ScimGroupService } from '../services/scim.group.service.js';
import { ScimServiceProviderService } from '../services/scim.service.provider.service.js';

/**
 * Options for {@link createScimRouter}. The caller either constructs the three services (wiring
 * them to their backing repositories and a logger) and hands them in, or passes `resolveServices`,
 * called with each request's context (see {@link fromRequestContainer}).
 */
export type CreateScimRouterOptions = ScimEndpointOptions<ServerKitContext> & {
  /** Optional middleware mounted on every route (e.g. `requireScimScope('users:read')`). */
  routeGuards?: ServerKitRouterMiddleware[];
};

/**
 * A `resolveServices` for {@link createScimRouter} that takes the three SCIM services from the
 * request's scoped container (`ctx.container`, set by `serverKitContextMiddleware`). Register
 * `ScimUserService`, `ScimGroupService` and `ScimServiceProviderService`, with your repositories
 * request-scoped, so each request's repositories see its own transaction or tenant.
 *
 * @param ctx - The request's context.
 * @returns The services resolved from the request's container.
 */
export const fromRequestContainer = (ctx: ServerKitContext): ScimServices => ({
  userService: ctx.container.get(ScimUserService),
  groupService: ctx.container.get(ScimGroupService),
  serviceProviderService: ctx.container.get(ScimServiceProviderService),
});

/**
 * Build a SCIM 2.0 server router. Mount it inside a Koa app that already has
 * `serverKitContextMiddleware` and `authenticationMiddleware` configured, and
 * use `scimErrorMiddleware()` instead of the default `errorMiddleware()` for
 * the SCIM mountpoint.
 *
 * Endpoints (RFC 7644 §3.4):
 * - `GET    /Users` — list users (with `filter`, `startIndex`, `count`, `sortBy`, `sortOrder`)
 * - `POST   /Users` — create user
 * - `GET    /Users/:id` — fetch one user
 * - `PUT    /Users/:id` — replace user
 * - `PATCH  /Users/:id` — apply PATCH ops
 * - `DELETE /Users/:id` — delete user
 * - `POST   /Users/.search` — list-via-POST so large filters can be sent in the body
 * - Same six endpoints for `/Groups` and `/Groups/.search`
 * - `GET    /Schemas`, `GET /Schemas/:id`
 * - `GET    /ResourceTypes`, `GET /ResourceTypes/:id`
 * - `GET    /ServiceProviderConfig`
 */
export const createScimRouter = (options: CreateScimRouterOptions): Router<unknown, ServerKitContext> => {
  const router = ServerKitRouter();
  const guards = options.routeGuards ?? [];
  const json = bodyParserMiddleware([SCIM_MEDIA_TYPE, 'application/json']);
  const servicesFor = scimServicesFrom(options);

  for (const route of createScimRouteTable(options)) {
    const middleware: ServerKitRouterMiddleware[] = route.body ? [...guards, json] : [...guards];
    router.register(
      route.path,
      [route.method],
      [
        ...middleware,
        async ctx => {
          // `bodyParserMiddleware` writes the parsed request body to `ctx.parsedBody`
          // (distinct from `ctx.body`, which is the response).
          const response = await route.handler({
            params: ctx.params,
            query: ctx.query,
            body: ctx.parsedBody,
            services: await servicesFor(ctx),
          });
          ctx.status = response.status;
          if (response.body !== undefined) {
            ctx.body = response.body;
            ctx.type = SCIM_MEDIA_TYPE;
          }
          if (response.location) ctx.set('Location', response.location);
        },
      ],
    );
  }

  return router;
};
