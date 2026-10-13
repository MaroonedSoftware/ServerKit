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
import { projectScimResource, type ScimProjection } from '../projection/attribute.projection.js';
import { userSchema } from '../schemas/user.schema.js';
import { groupSchema } from '../schemas/group.schema.js';
import { enterpriseUserSchema } from '../schemas/enterprise.user.schema.js';

/**
 * Options shared by every SCIM transport. The caller constructs the three services (wiring them
 * to their backing repositories and a logger) and hands them in.
 */
export interface ScimEndpointOptions {
  /** Service handling all `/Users` endpoints. */
  userService: ScimUserService;
  /** Service handling all `/Groups` endpoints. */
  groupService: ScimGroupService;
  /** Service that owns `/Schemas`, `/ResourceTypes`, `/ServiceProviderConfig`. */
  serviceProviderService: ScimServiceProviderService;
  /**
   * Maximum page size returned from list endpoints. Defaults to the
   * `serviceProviderService` `filter.maxResults` value, falling back to 200.
   */
  maxResults?: number;
  /**
   * Absolute base URL the endpoints are reachable at, e.g.
   * `https://api.example.com/scim/v2`. When set, `meta.location` and the
   * `Location` response header are rendered against it, as RFC 7643 §3.1 wants
   * a resource URI. Leave it unset to keep the previous behaviour of emitting a
   * root-relative path (`/Users/{id}`), which is wrong for any deployment that
   * mounts the endpoints under a prefix.
   */
  baseUrl?: string;
}

/** The transport-neutral view of a request a SCIM endpoint needs. */
export interface ScimEndpointRequest {
  /** Route parameters; `id` for the single-resource endpoints. */
  params: Record<string, string | undefined>;
  /** The parsed query string. */
  query: Record<string, unknown>;
  /** The parsed request body, for the endpoints that take one. */
  body?: unknown;
}

/** What a SCIM endpoint answers; the transport writes it with the SCIM media type. */
export interface ScimEndpointResponse {
  status: 200 | 201 | 204;
  body?: unknown;
  /** Value for the `Location` header, set on creates. */
  location?: string;
}

/** A transport-neutral SCIM endpoint handler. */
export type ScimEndpoint = (request: ScimEndpointRequest) => Promise<ScimEndpointResponse>;

/** One SCIM route: method, path relative to the mountpoint, whether it reads a body, and its handler. */
export interface ScimRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  /** Whether the route accepts a request body (and so needs body parsing). */
  body: boolean;
  handler: ScimEndpoint;
}

/**
 * Build the SCIM 2.0 endpoints (RFC 7644 §3.4) independently of any HTTP framework. A transport
 * mounts each {@link ScimRoute} with its own idiom, runs its guards first, and writes the
 * {@link ScimEndpointResponse}. Thrown errors are `ScimError`s / `HttpError`s for the transport's
 * SCIM error handler to render.
 *
 * Routes are listed in registration order; `/.search` precedes `/:id` so routers that match in
 * order resolve it correctly.
 */
export const createScimRouteTable = (options: ScimEndpointOptions): ScimRoute[] => {
  const maxResults = options.maxResults ?? options.serviceProviderService.getServiceProviderConfig().filter.maxResults ?? 200;
  const baseUrl = options.baseUrl?.replace(/\/+$/, '');

  /**
   * Render a resource's `meta.location` against the configured base URL. The
   * services assign a root-relative path because they do not know where the
   * endpoints are mounted; without a `baseUrl` that path is left as-is.
   */
  const withLocation = <T extends { id: string; meta: { location?: string } }>(resource: T, endpoint: 'Users' | 'Groups'): T =>
    baseUrl ? { ...resource, meta: { ...resource.meta, location: `${baseUrl}/${endpoint}/${resource.id}` } } : resource;

  const ok = (body: unknown): ScimEndpointResponse => ({ status: 200, body });
  const id = (request: ScimEndpointRequest): string => request.params.id ?? '';

  const users = options.userService;
  const groups = options.groupService;
  const provider = options.serviceProviderService;

  // Discovery endpoints — RFC 7644 §4 says these MAY be unauthenticated. Transports apply the
  // route guards anyway so the consumer can decide.
  return [
    { method: 'GET', path: '/ServiceProviderConfig', body: false, handler: async () => ok(provider.getServiceProviderConfig()) },
    { method: 'GET', path: '/Schemas', body: false, handler: async () => ok(listEnvelope(provider.listSchemas())) },
    { method: 'GET', path: '/Schemas/:id', body: false, handler: async request => ok(provider.getSchema(id(request))) },
    { method: 'GET', path: '/ResourceTypes', body: false, handler: async () => ok(listEnvelope(provider.listResourceTypes())) },
    { method: 'GET', path: '/ResourceTypes/:id', body: false, handler: async request => ok(provider.getResourceType(id(request))) },

    // Users
    {
      method: 'GET',
      path: '/Users',
      body: false,
      handler: async request => {
        const query = parseListQueryFromUrl(request.query, maxResults);
        const result = await users.list(query);
        return ok(
          listEnvelope(
            result.resources.map(user => projectUser(withLocation(user, 'Users'), query)),
            query,
            result.totalResults,
          ),
        );
      },
    },
    {
      method: 'POST',
      path: '/Users/.search',
      body: true,
      handler: async request => {
        const query = parseListQueryFromBody(request.body, maxResults);
        const result = await users.list(query);
        return ok(
          listEnvelope(
            result.resources.map(user => projectUser(withLocation(user, 'Users'), query)),
            query,
            result.totalResults,
          ),
        );
      },
    },
    {
      method: 'POST',
      path: '/Users',
      body: true,
      handler: async request => {
        const located = withLocation(await users.create(request.body as Partial<ScimUser>), 'Users');
        return { status: 201, body: projectUser(located, parseProjectionFromUrl(request.query)), location: located.meta.location };
      },
    },
    {
      method: 'GET',
      path: '/Users/:id',
      body: false,
      handler: async request => ok(projectUser(withLocation(await users.get(id(request)), 'Users'), parseProjectionFromUrl(request.query))),
    },
    {
      method: 'PUT',
      path: '/Users/:id',
      body: true,
      handler: async request =>
        ok(
          projectUser(
            withLocation(await users.replace(id(request), request.body as Partial<ScimUser>), 'Users'),
            parseProjectionFromUrl(request.query),
          ),
        ),
    },
    {
      method: 'PATCH',
      path: '/Users/:id',
      body: true,
      handler: async request => {
        const ops = validatePatchRequest(request.body);
        return ok(projectUser(withLocation(await users.patch(id(request), ops), 'Users'), parseProjectionFromUrl(request.query)));
      },
    },
    {
      method: 'DELETE',
      path: '/Users/:id',
      body: false,
      handler: async request => {
        await users.delete(id(request));
        return { status: 204 };
      },
    },

    // Groups
    {
      method: 'GET',
      path: '/Groups',
      body: false,
      handler: async request => {
        const query = parseListQueryFromUrl(request.query, maxResults);
        const result = await groups.list(query);
        return ok(
          listEnvelope(
            result.resources.map(group => projectGroup(withLocation(group, 'Groups'), query)),
            query,
            result.totalResults,
          ),
        );
      },
    },
    {
      method: 'POST',
      path: '/Groups/.search',
      body: true,
      handler: async request => {
        const query = parseListQueryFromBody(request.body, maxResults);
        const result = await groups.list(query);
        return ok(
          listEnvelope(
            result.resources.map(group => projectGroup(withLocation(group, 'Groups'), query)),
            query,
            result.totalResults,
          ),
        );
      },
    },
    {
      method: 'POST',
      path: '/Groups',
      body: true,
      handler: async request => {
        const located = withLocation(await groups.create(request.body as Partial<ScimGroup>), 'Groups');
        return { status: 201, body: projectGroup(located, parseProjectionFromUrl(request.query)), location: located.meta.location };
      },
    },
    {
      method: 'GET',
      path: '/Groups/:id',
      body: false,
      handler: async request => ok(projectGroup(withLocation(await groups.get(id(request)), 'Groups'), parseProjectionFromUrl(request.query))),
    },
    {
      method: 'PUT',
      path: '/Groups/:id',
      body: true,
      handler: async request =>
        ok(
          projectGroup(
            withLocation(await groups.replace(id(request), request.body as Partial<ScimGroup>), 'Groups'),
            parseProjectionFromUrl(request.query),
          ),
        ),
    },
    {
      method: 'PATCH',
      path: '/Groups/:id',
      body: true,
      handler: async request => {
        const ops = validatePatchRequest(request.body);
        return ok(projectGroup(withLocation(await groups.patch(id(request), ops), 'Groups'), parseProjectionFromUrl(request.query)));
      },
    },
    {
      method: 'DELETE',
      path: '/Groups/:id',
      body: false,
      handler: async request => {
        await groups.delete(id(request));
        return { status: 204 };
      },
    },
  ];
};

/** Schemas a `/Users` response is projected against: the core one plus the enterprise extension. */
const userSchemas = [userSchema, enterpriseUserSchema];

/**
 * Project a user for the wire. Applies the requested `attributes` /
 * `excludedAttributes` and always strips attributes the schema declares
 * `returned: 'never'` — notably `password`, which is `writeOnly` and must never
 * come back out of a repository that stored what it was given.
 */
const projectUser = (user: ScimUser, projection: ScimProjection): ScimUser =>
  projectScimResource(user as unknown as Record<string, unknown>, userSchemas, projection) as unknown as ScimUser;

/** Project a group for the wire. See {@link projectUser}. */
const projectGroup = (group: ScimGroup, projection: ScimProjection): ScimGroup =>
  projectScimResource(group as unknown as Record<string, unknown>, [groupSchema], projection) as unknown as ScimGroup;

/**
 * Read the `attributes` / `excludedAttributes` projection from a query string.
 * RFC 7644 §3.9 allows them on single-resource reads and writes as well as lists.
 */
const parseProjectionFromUrl = (query: Record<string, unknown>): ScimProjection => ({
  attributes: parseCsvParam(pickStringParam(query, 'attributes')),
  excludedAttributes: parseCsvParam(pickStringParam(query, 'excludedAttributes')),
});

const parseListQueryFromUrl = (query: Record<string, unknown>, maxResults: number): ScimListQuery => {
  const filterRaw = pickStringParam(query, 'filter');
  return {
    filter: filterRaw ? parseScimFilter(filterRaw) : undefined,
    startIndex: parsePositiveInt(pickStringParam(query, 'startIndex'), 1),
    count: clamp(parseCount(pickStringParam(query, 'count'), maxResults), 0, maxResults),
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
    excludedAttributes: Array.isArray(body.excludedAttributes)
      ? body.excludedAttributes.filter((a): a is string => typeof a === 'string')
      : undefined,
  };
};

const parseSortOrder = (raw: string | undefined): ScimSortOrder | undefined => {
  if (raw === 'ascending' || raw === 'descending') return raw;
  return undefined;
};

/**
 * Parse the `count` query parameter. RFC 7644 §3.4.2.4 gives a value below 1 its own
 * meaning — return no resources, but still report `totalResults` — which is the probe
 * Okta and Entra make when setting up a connection. A non-numeric or absent value
 * falls back to the configured page size.
 */
const parseCount = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n < 1 ? 0 : Math.floor(n);
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
  const parts = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
};

const pickStringParam = (query: Record<string, unknown>, key: string): string | undefined => {
  const value = query[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
};

const validatePatchRequest = (body: unknown): ScimPatchOp[] => {
  if (!isPlainObject(body)) {
    throw scimError(400, 'invalidSyntax', 'Bad Request').withDetails({ message: 'PATCH request must be a JSON object' });
  }
  const request = body as Partial<ScimPatchRequest>;
  if (!Array.isArray(request.schemas) || !request.schemas.includes(PatchOpSchema)) {
    throw scimError(400, 'invalidSyntax', 'Bad Request').withDetails({ message: `PATCH request schemas must include "${PatchOpSchema}"` });
  }
  if (!Array.isArray(request.Operations) || request.Operations.length === 0) {
    throw scimError(400, 'invalidValue', 'Bad Request').withDetails({ message: '"Operations" must be a non-empty array' });
  }
  return request.Operations;
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
