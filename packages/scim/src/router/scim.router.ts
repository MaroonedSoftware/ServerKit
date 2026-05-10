import type { ServerKitContext, ServerKitRouterMiddleware } from '@maroonedsoftware/koa';
import { bodyParserMiddleware, ServerKitRouter } from '@maroonedsoftware/koa';
import type Router from '@koa/router';
import { ScimUserService } from '../services/scim.user.service.js';
import { ScimGroupService } from '../services/scim.group.service.js';
import { ScimServiceProviderService } from '../services/scim.service.provider.service.js';
import type { ScimUser } from '../types/scim.user.js';
import type { ScimGroup } from '../types/scim.group.js';
import { type ScimPatchOp, type ScimPatchRequest, PatchOpSchema } from '../types/patch.op.js';
import { ListResponseSchema, type ScimListResponse } from '../types/list.response.js';
import { type ScimListQuery, type ScimSortOrder } from '../repositories/repository.types.js';
import { parseScimFilter } from '../filter/filter.parser.js';
import { scimError } from '../errors/scim.error.js';
import { SCIM_MEDIA_TYPE } from '../middleware/scim.content.type.middleware.js';

/**
 * Options for {@link createScimRouter}. The caller constructs the three
 * services (wiring them to their backing repositories and a logger) and
 * hands them in.
 */
export interface CreateScimRouterOptions {
  /** Service handling all `/Users` endpoints. */
  userService: ScimUserService;
  /** Service handling all `/Groups` endpoints. */
  groupService: ScimGroupService;
  /** Service that owns `/Schemas`, `/ResourceTypes`, `/ServiceProviderConfig`. */
  serviceProviderService: ScimServiceProviderService;
  /** Optional middleware mounted on every route (e.g. `requireScimScope('users:read')`). */
  routeGuards?: ServerKitRouterMiddleware[];
  /**
   * Maximum page size returned from list endpoints. Defaults to the
   * `serviceProviderService` `filter.maxResults` value, falling back to 200.
   */
  maxResults?: number;
}

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
  const maxResults = options.maxResults ?? options.serviceProviderService.getServiceProviderConfig().filter.maxResults ?? 200;

  // Discovery endpoints — RFC 7644 §4 says these MAY be unauthenticated. Apply
  // the route guards anyway so the consumer can decide.
  router.get('/ServiceProviderConfig', ...guards, async ctx => {
    ctx.body = options.serviceProviderService.getServiceProviderConfig();
    ctx.type = SCIM_MEDIA_TYPE;
  });

  router.get('/Schemas', ...guards, async ctx => {
    ctx.body = listEnvelope(options.serviceProviderService.listSchemas());
    ctx.type = SCIM_MEDIA_TYPE;
  });

  router.get('/Schemas/:id', ...guards, async ctx => {
    ctx.body = options.serviceProviderService.getSchema(ctx.params.id!);
    ctx.type = SCIM_MEDIA_TYPE;
  });

  router.get('/ResourceTypes', ...guards, async ctx => {
    ctx.body = listEnvelope(options.serviceProviderService.listResourceTypes());
    ctx.type = SCIM_MEDIA_TYPE;
  });

  router.get('/ResourceTypes/:id', ...guards, async ctx => {
    ctx.body = options.serviceProviderService.getResourceType(ctx.params.id!);
    ctx.type = SCIM_MEDIA_TYPE;
  });

  // Users
  router.get('/Users', ...guards, async ctx => {
    const query = parseListQueryFromUrl(ctx.query, maxResults);
    const result = await options.userService.list(query);
    ctx.body = listEnvelope(result.resources, query, result.totalResults);
    ctx.type = SCIM_MEDIA_TYPE;
  });

  router.post('/Users/.search', ...guards, json, async ctx => {
    const requestBody = takeRequestBody(ctx);
    const query = parseListQueryFromBody(requestBody, maxResults);
    const result = await options.userService.list(query);
    ctx.body = listEnvelope(result.resources, query, result.totalResults);
    ctx.type = SCIM_MEDIA_TYPE;
  });

  router.post('/Users', ...guards, json, async ctx => {
    const payload = takeRequestBody(ctx) as Partial<ScimUser>;
    const created = await options.userService.create(payload);
    ctx.status = 201;
    ctx.body = created;
    ctx.type = SCIM_MEDIA_TYPE;
    if (created.meta.location) ctx.set('Location', created.meta.location);
  });

  router.get('/Users/:id', ...guards, async ctx => {
    ctx.body = await options.userService.get(ctx.params.id!);
    ctx.type = SCIM_MEDIA_TYPE;
  });

  router.put('/Users/:id', ...guards, json, async ctx => {
    const payload = takeRequestBody(ctx) as Partial<ScimUser>;
    ctx.body = await options.userService.replace(ctx.params.id!, payload);
    ctx.type = SCIM_MEDIA_TYPE;
  });

  router.patch('/Users/:id', ...guards, json, async ctx => {
    const requestBody = takeRequestBody(ctx) as Partial<ScimPatchRequest>;
    const ops = validatePatchRequest(requestBody);
    ctx.body = await options.userService.patch(ctx.params.id!, ops);
    ctx.type = SCIM_MEDIA_TYPE;
  });

  router.delete('/Users/:id', ...guards, async ctx => {
    await options.userService.delete(ctx.params.id!);
    ctx.status = 204;
  });

  // Groups
  router.get('/Groups', ...guards, async ctx => {
    const query = parseListQueryFromUrl(ctx.query, maxResults);
    const result = await options.groupService.list(query);
    ctx.body = listEnvelope(result.resources, query, result.totalResults);
    ctx.type = SCIM_MEDIA_TYPE;
  });

  router.post('/Groups/.search', ...guards, json, async ctx => {
    const requestBody = takeRequestBody(ctx);
    const query = parseListQueryFromBody(requestBody, maxResults);
    const result = await options.groupService.list(query);
    ctx.body = listEnvelope(result.resources, query, result.totalResults);
    ctx.type = SCIM_MEDIA_TYPE;
  });

  router.post('/Groups', ...guards, json, async ctx => {
    const payload = takeRequestBody(ctx) as Partial<ScimGroup>;
    const created = await options.groupService.create(payload);
    ctx.status = 201;
    ctx.body = created;
    ctx.type = SCIM_MEDIA_TYPE;
    if (created.meta.location) ctx.set('Location', created.meta.location);
  });

  router.get('/Groups/:id', ...guards, async ctx => {
    ctx.body = await options.groupService.get(ctx.params.id!);
    ctx.type = SCIM_MEDIA_TYPE;
  });

  router.put('/Groups/:id', ...guards, json, async ctx => {
    const payload = takeRequestBody(ctx) as Partial<ScimGroup>;
    ctx.body = await options.groupService.replace(ctx.params.id!, payload);
    ctx.type = SCIM_MEDIA_TYPE;
  });

  router.patch('/Groups/:id', ...guards, json, async ctx => {
    const requestBody = takeRequestBody(ctx) as Partial<ScimPatchRequest>;
    const ops = validatePatchRequest(requestBody);
    ctx.body = await options.groupService.patch(ctx.params.id!, ops);
    ctx.type = SCIM_MEDIA_TYPE;
  });

  router.delete('/Groups/:id', ...guards, async ctx => {
    await options.groupService.delete(ctx.params.id!);
    ctx.status = 204;
  });

  return router;
};

/**
 * `bodyParserMiddleware` writes the parsed request body to `ctx.body` (the
 * codebase convention). Move it into a local before the handler reassigns
 * `ctx.body` to the response.
 */
const takeRequestBody = (ctx: ServerKitContext): unknown => {
  const body = ctx.body;
  ctx.body = undefined;
  return body;
};

const parseListQueryFromUrl = (query: ServerKitContext['query'], maxResults: number): ScimListQuery => {
  const filterRaw = pickStringParam(query, 'filter');
  return {
    filter: filterRaw ? parseScimFilter(filterRaw) : undefined,
    startIndex: parsePositiveInt(pickStringParam(query, 'startIndex'), 1),
    count: clamp(parsePositiveInt(pickStringParam(query, 'count'), maxResults), 0, maxResults),
    sortBy: pickStringParam(query, 'sortBy'),
    sortOrder: parseSortOrder(pickStringParam(query, 'sortOrder')),
    attributes: parseCsvParam(pickStringParam(query, 'attributes')),
    excludedAttributes: parseCsvParam(pickStringParam(query, 'excludedAttributes')),
  };
};

const parseListQueryFromBody = (body: unknown, maxResults: number): ScimListQuery => {
  if (!isPlainObject(body)) {
    throw scimError(400, 'invalidSyntax', 'Bad Request').withDetails({ message: 'Search body must be a JSON object' });
  }
  const filterRaw = typeof body.filter === 'string' ? body.filter : undefined;
  return {
    filter: filterRaw ? parseScimFilter(filterRaw) : undefined,
    startIndex: typeof body.startIndex === 'number' && body.startIndex > 0 ? Math.floor(body.startIndex) : 1,
    count: clamp(typeof body.count === 'number' ? Math.floor(body.count) : maxResults, 0, maxResults),
    sortBy: typeof body.sortBy === 'string' ? body.sortBy : undefined,
    sortOrder: parseSortOrder(typeof body.sortOrder === 'string' ? body.sortOrder : undefined),
    attributes: Array.isArray(body.attributes) ? body.attributes.filter((a): a is string => typeof a === 'string') : undefined,
    excludedAttributes: Array.isArray(body.excludedAttributes) ? body.excludedAttributes.filter((a): a is string => typeof a === 'string') : undefined,
  };
};

const parseSortOrder = (raw: string | undefined): ScimSortOrder | undefined => {
  if (raw === 'ascending' || raw === 'descending') return raw;
  return undefined;
};

const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const parseCsvParam = (raw: string | undefined): string[] | undefined => {
  if (!raw) return undefined;
  const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
};

const pickStringParam = (query: ServerKitContext['query'], key: string): string | undefined => {
  const value = query[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
};

const validatePatchRequest = (body: Partial<ScimPatchRequest> | unknown): ScimPatchOp[] => {
  if (!isPlainObject(body)) {
    throw scimError(400, 'invalidSyntax', 'Bad Request').withDetails({ message: 'PATCH request must be a JSON object' });
  }
  if (!Array.isArray(body.schemas) || !body.schemas.includes(PatchOpSchema)) {
    throw scimError(400, 'invalidSyntax', 'Bad Request').withDetails({ message: `PATCH request schemas must include "${PatchOpSchema}"` });
  }
  if (!Array.isArray(body.Operations) || body.Operations.length === 0) {
    throw scimError(400, 'invalidValue', 'Bad Request').withDetails({ message: '"Operations" must be a non-empty array' });
  }
  return body.Operations as ScimPatchOp[];
};

const listEnvelope = <T>(resources: T[], query?: ScimListQuery, total?: number): ScimListResponse<T> => ({
  schemas: [ListResponseSchema],
  totalResults: total ?? resources.length,
  startIndex: query?.startIndex ?? 1,
  itemsPerPage: resources.length,
  Resources: resources,
});

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};
