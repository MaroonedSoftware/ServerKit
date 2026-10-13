import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { Logger } from '@maroonedsoftware/logger';
import { ServerKitServerBuilder, bodyParserPlugin, errorPlugin, serverKitContextPlugin, serverKitPlugin } from '@maroonedsoftware/fastify';
import { type AuthenticationSession, invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { scimRoutes } from '../src/fastify/scim.fastify.routes.js';
import { requireScimScope } from '../src/fastify/require.scim.scope.hook.js';
import { ScimUserService } from '../src/services/scim.user.service.js';
import { ScimGroupService } from '../src/services/scim.group.service.js';
import { ScimServiceProviderService } from '../src/services/scim.service.provider.service.js';
import { SCIM_MEDIA_TYPE } from '../src/scim.media.type.js';
import { UserSchemaId } from '../src/schemas/user.schema.js';
import { ListResponseSchema } from '../src/types/list.response.js';
import { PatchOpSchema } from '../src/types/patch.op.js';
import { ScimErrorSchema } from '../src/errors/scim.error.js';
import type { ScimListQuery } from '../src/repositories/repository.types.js';
import { InMemoryGroupRepository, InMemoryUserRepository, silentLogger } from './in.memory.repos.js';

interface BuildOptions {
  authenticated?: boolean;
  scopes?: string[];
  baseUrl?: string;
  prefix?: string;
}

const sessionFor = (options: BuildOptions): AuthenticationSession =>
  options.authenticated === false
    ? invalidAuthenticationSession
    : // requireScimScope only inspects `claims.scimScopes`, so the rest of the
      // session fields are irrelevant for these tests.
      ({
        sessionToken: 'test',
        subject: 'tester',
        factors: [],
        claims: { scimScopes: options.scopes ?? ['scim'] },
      } as unknown as AuthenticationSession);

const createServices = () => {
  const userRepository = new InMemoryUserRepository();
  const groupRepository = new InMemoryGroupRepository();
  return {
    userRepository,
    groupRepository,
    userService: new ScimUserService(userRepository, silentLogger),
    groupService: new ScimGroupService(groupRepository, silentLogger),
    serviceProviderService: new ScimServiceProviderService(),
  };
};

/** A ServerKit Fastify server: errors, request context, and ServerKit body parsing, then the SCIM routes. */
const buildApp = async (options: BuildOptions = {}) => {
  const { userRepository, groupRepository, ...services } = createServices();

  const builder = new ServerKitServerBuilder();
  await builder.setup(new AppConfig({}), silentLogger as unknown as Logger, []);
  builder.setupPlugins(container => [
    errorPlugin(container),
    serverKitContextPlugin(container),
    bodyParserPlugin(),
    // Stand-in for authenticationPlugin: inject a fake session before the routes run.
    serverKitPlugin('test.authentication', async app => {
      app.addHook('onRequest', async request => {
        request.authenticationSession = sessionFor(options);
      });
    }),
  ]);
  const plugin = scimRoutes({ ...services, routeGuards: [requireScimScope('scim')], baseUrl: options.baseUrl });
  builder.setupRoutes([options.prefix ? { plugin, prefix: options.prefix } : plugin]);
  await builder.app.ready();

  return { app: builder.app, userRepository, groupRepository };
};

const send = (app: FastifyInstance, method: 'POST' | 'PUT' | 'PATCH', url: string, body: unknown, contentType = SCIM_MEDIA_TYPE) =>
  app.inject({ method, url, headers: { 'content-type': contentType }, payload: typeof body === 'string' ? body : JSON.stringify(body) });

const post = (app: FastifyInstance, url: string, body: unknown) => send(app, 'POST', url, body);
const get = (app: FastifyInstance, url: string) => app.inject({ method: 'GET', url });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: LightMyRequestResponse): any => res.json();

describe('scimRoutes — integration', () => {
  describe('Users', () => {
    it('creates a user and returns 201 with Location', async () => {
      const { app } = await buildApp();
      const res = await post(app, '/Users', { schemas: [UserSchemaId], userName: 'bjensen' });
      expect(res.statusCode).toBe(201);
      expect(res.headers['content-type']).toContain(SCIM_MEDIA_TYPE);
      expect(res.headers['location']).toMatch(/^\/Users\//);
      const body = json(res);
      expect(body.userName).toBe('bjensen');
      expect(body.id).toBeDefined();
      expect(body.meta.resourceType).toBe('User');
    });

    it('accepts application/json as well as application/scim+json', async () => {
      const { app } = await buildApp();
      const res = await send(app, 'POST', '/Users', { userName: 'bjensen' }, 'application/json');
      expect(res.statusCode).toBe(201);
      expect(res.headers['content-type']).toContain(SCIM_MEDIA_TYPE);
    });

    it('GET /Users lists in a SCIM ListResponse envelope', async () => {
      const { app } = await buildApp();
      await post(app, '/Users', { userName: 'a' });
      await post(app, '/Users', { userName: 'b' });
      const res = await get(app, '/Users');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain(SCIM_MEDIA_TYPE);
      const body = json(res);
      expect(body.schemas).toEqual([ListResponseSchema]);
      expect(body.totalResults).toBe(2);
      expect(body.itemsPerPage).toBe(2);
      expect(body.Resources).toHaveLength(2);
    });

    it('GET /Users with filter narrows the result set', async () => {
      const { app } = await buildApp();
      await post(app, '/Users', { userName: 'alice' });
      await post(app, '/Users', { userName: 'bob' });
      const res = await get(app, '/Users?filter=' + encodeURIComponent('userName eq "alice"'));
      expect(res.statusCode).toBe(200);
      expect(json(res).totalResults).toBe(1);
      expect(json(res).Resources[0].userName).toBe('alice');
    });

    it('GET /Users passes startIndex, count, sortBy, and sortOrder to the repository', async () => {
      const { app, userRepository } = await buildApp();
      for (const userName of ['carol', 'alice', 'bob']) await post(app, '/Users', { userName });
      const list = userRepository.list.bind(userRepository);
      let seen: ScimListQuery | undefined;
      userRepository.list = async query => {
        seen = query;
        return list(query);
      };
      const body = json(await get(app, '/Users?startIndex=2&count=1&sortBy=userName&sortOrder=descending'));
      expect(seen).toMatchObject({ startIndex: 2, count: 1, sortBy: 'userName', sortOrder: 'descending' });
      expect(body.totalResults).toBe(3);
      expect(body.startIndex).toBe(2);
      expect(body.Resources).toHaveLength(1);
    });

    it('POST /Users/.search accepts the filter in the body', async () => {
      const { app } = await buildApp();
      await post(app, '/Users', { userName: 'alice' });
      const res = await post(app, '/Users/.search', { filter: 'userName eq "alice"' });
      expect(res.statusCode).toBe(200);
      expect(json(res).totalResults).toBe(1);
    });

    it('PUT replaces a user', async () => {
      const { app } = await buildApp();
      const created = json(await post(app, '/Users', { userName: 'bjensen', displayName: 'Barbara' }));
      const res = await send(app, 'PUT', `/Users/${created.id}`, { userName: 'bjensen', displayName: 'Babs' });
      expect(res.statusCode).toBe(200);
      expect(json(res).displayName).toBe('Babs');
    });

    it('PATCH replaces a user attribute', async () => {
      const { app } = await buildApp();
      const created = json(await post(app, '/Users', { userName: 'bjensen' }));
      const res = await send(app, 'PATCH', `/Users/${created.id}`, {
        schemas: [PatchOpSchema],
        Operations: [{ op: 'add', path: 'displayName', value: 'Barbara' }],
      });
      expect(res.statusCode).toBe(200);
      expect(json(res).displayName).toBe('Barbara');
    });

    it('PATCH without the PatchOp schema is a 400 invalidSyntax', async () => {
      const { app } = await buildApp();
      const created = json(await post(app, '/Users', { userName: 'bjensen' }));
      const res = await send(app, 'PATCH', `/Users/${created.id}`, { Operations: [{ op: 'add', path: 'displayName', value: 'B' }] });
      expect(res.statusCode).toBe(400);
      expect(json(res)).toMatchObject({ schemas: [ScimErrorSchema], scimType: 'invalidSyntax' });
    });

    it('DELETE /Users/:id returns 204', async () => {
      const { app, userRepository } = await buildApp();
      const created = json(await post(app, '/Users', { userName: 'bjensen' }));
      const res = await app.inject({ method: 'DELETE', url: `/Users/${created.id}` });
      expect(res.statusCode).toBe(204);
      expect(res.payload).toBe('');
      expect(userRepository.users.size).toBe(0);
    });

    it('GET /Users/:id 404 returns SCIM error envelope', async () => {
      const { app } = await buildApp();
      const res = await get(app, '/Users/missing');
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain(SCIM_MEDIA_TYPE);
      expect(json(res)).toMatchObject({ schemas: [ScimErrorSchema], status: '404' });
      // Provisioning clients surface `detail` to the operator, so it has to name the resource.
      expect(json(res).detail).toContain('missing');
    });

    it('POST /Users 409 explains which userName collided', async () => {
      const { app } = await buildApp();
      await post(app, '/Users', { userName: 'bjensen' });
      const res = await post(app, '/Users', { userName: 'bjensen' });
      expect(res.statusCode).toBe(409);
      expect(json(res).scimType).toBe('uniqueness');
      expect(json(res).detail).toContain('bjensen');
    });

    it('GET /Users?count=0 returns no resources but still reports totalResults', async () => {
      // The connection-setup probe Okta and Entra make: "how many users are there?"
      const { app } = await buildApp();
      await post(app, '/Users', { userName: 'alice' });
      await post(app, '/Users', { userName: 'bob' });
      const res = await get(app, '/Users?count=0');
      expect(res.statusCode).toBe(200);
      expect(json(res).totalResults).toBe(2);
      expect(json(res).Resources).toEqual([]);
      expect(json(res).itemsPerPage).toBe(0);
    });

    it('GET /Users?count=0 agrees with the same count in a .search body', async () => {
      const { app } = await buildApp();
      await post(app, '/Users', { userName: 'alice' });
      const fromUrl = json(await get(app, '/Users?count=0'));
      const fromBody = json(await post(app, '/Users/.search', { count: 0 }));
      expect(fromUrl.Resources).toEqual(fromBody.Resources);
      expect(fromUrl.totalResults).toBe(fromBody.totalResults);
    });

    it('GET /Users falls back to the page size for a non-numeric count', async () => {
      const { app } = await buildApp();
      await post(app, '/Users', { userName: 'alice' });
      const res = await get(app, '/Users?count=notanumber');
      expect(res.statusCode).toBe(200);
      expect(json(res).Resources).toHaveLength(1);
    });

    it('never returns password, even though the repository stored it', async () => {
      const { app } = await buildApp();
      const created = json(await post(app, '/Users', { userName: 'bjensen', password: 'hunter2' }));
      expect(created.password).toBeUndefined();
      expect(json(await get(app, `/Users/${created.id}`)).password).toBeUndefined();
      expect(json(await get(app, '/Users')).Resources[0].password).toBeUndefined();
    });

    it('GET /Users/:id?attributes= returns only the requested attributes plus the core ones', async () => {
      const { app } = await buildApp();
      const created = json(await post(app, '/Users', { userName: 'bjensen', displayName: 'Barbara Jensen' }));
      const body = json(await get(app, `/Users/${created.id}?attributes=userName`));
      expect(body.userName).toBe('bjensen');
      expect(body.displayName).toBeUndefined();
      expect(body.id).toBe(created.id);
      expect(body.schemas).toBeDefined();
    });

    it('GET /Users?excludedAttributes= omits the named attribute from every resource', async () => {
      const { app } = await buildApp();
      await post(app, '/Users', { userName: 'bjensen', displayName: 'Barbara Jensen' });
      const body = json(await get(app, '/Users?excludedAttributes=displayName'));
      expect(body.Resources[0].userName).toBe('bjensen');
      expect(body.Resources[0].displayName).toBeUndefined();
    });

    it('POST /Users/.search honours attributes from the request body', async () => {
      const { app } = await buildApp();
      await post(app, '/Users', { userName: 'bjensen', displayName: 'Barbara Jensen' });
      const body = json(await post(app, '/Users/.search', { attributes: ['userName'] }));
      expect(body.Resources[0].userName).toBe('bjensen');
      expect(body.Resources[0].displayName).toBeUndefined();
    });

    it('renders meta.location and the Location header against baseUrl', async () => {
      const { app } = await buildApp({ baseUrl: 'https://api.example.com/scim/v2' });
      const res = await post(app, '/Users', { userName: 'bjensen' });
      const created = json(res);
      const expected = `https://api.example.com/scim/v2/Users/${created.id}`;
      expect(created.meta.location).toBe(expected);
      expect(res.headers['location']).toBe(expected);
      expect(json(await get(app, `/Users/${created.id}`)).meta.location).toBe(expected);
      expect(json(await get(app, '/Users')).Resources[0].meta.location).toBe(expected);
    });

    it('strips a trailing slash from baseUrl rather than doubling it', async () => {
      const { app } = await buildApp({ baseUrl: 'https://api.example.com/scim/v2/' });
      const created = json(await post(app, '/Users', { userName: 'bjensen' }));
      expect(created.meta.location).toBe(`https://api.example.com/scim/v2/Users/${created.id}`);
    });

    it('keeps the root-relative path when no baseUrl is configured', async () => {
      const { app } = await buildApp();
      const created = json(await post(app, '/Users', { userName: 'bjensen' }));
      expect(created.meta.location).toBe(`/Users/${created.id}`);
    });

    it('POST /Users 400 names the missing required attribute', async () => {
      const { app } = await buildApp();
      const res = await post(app, '/Users', {});
      expect(res.statusCode).toBe(400);
      expect(json(res).detail).toContain('userName');
    });
  });

  describe('Groups', () => {
    it('creates, fetches, patches, lists, and deletes a group', async () => {
      const { app, groupRepository } = await buildApp();
      const createdRes = await post(app, '/Groups', { displayName: 'Engineering' });
      expect(createdRes.statusCode).toBe(201);
      expect(createdRes.headers['location']).toMatch(/^\/Groups\//);
      const created = json(createdRes);

      expect(json(await get(app, `/Groups/${created.id}`)).displayName).toBe('Engineering');

      const patched = await send(app, 'PATCH', `/Groups/${created.id}`, {
        schemas: [PatchOpSchema],
        Operations: [{ op: 'replace', path: 'displayName', value: 'Platform' }],
      });
      expect(json(patched).displayName).toBe('Platform');

      const listed = json(await get(app, '/Groups?filter=' + encodeURIComponent('displayName eq "Platform"')));
      expect(listed.totalResults).toBe(1);

      expect(json(await post(app, '/Groups/.search', { filter: 'displayName eq "Platform"' })).totalResults).toBe(1);

      expect((await app.inject({ method: 'DELETE', url: `/Groups/${created.id}` })).statusCode).toBe(204);
      expect(groupRepository.groups.size).toBe(0);
    });

    it('renders group locations against baseUrl too', async () => {
      const { app } = await buildApp({ baseUrl: 'https://api.example.com/scim/v2' });
      const created = json(await post(app, '/Groups', { displayName: 'Engineering' }));
      expect(created.meta.location).toBe(`https://api.example.com/scim/v2/Groups/${created.id}`);
    });
  });

  describe('Discovery', () => {
    it('GET /ServiceProviderConfig returns the config', async () => {
      const { app } = await buildApp();
      const res = await get(app, '/ServiceProviderConfig');
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain(SCIM_MEDIA_TYPE);
      expect(json(res).patch.supported).toBe(true);
      expect(json(res).filter.supported).toBe(true);
    });

    it('GET /Schemas lists all schemas in a ListResponse', async () => {
      const { app } = await buildApp();
      const res = await get(app, '/Schemas');
      expect(res.statusCode).toBe(200);
      expect(json(res).schemas).toEqual([ListResponseSchema]);
      expect(json(res).Resources.map((s: { id: string }) => s.id)).toContain(UserSchemaId);
    });

    it('GET /Schemas/:id returns one schema', async () => {
      const { app } = await buildApp();
      const res = await get(app, `/Schemas/${encodeURIComponent(UserSchemaId)}`);
      expect(res.statusCode).toBe(200);
      expect(json(res).id).toBe(UserSchemaId);
    });

    it('GET /ResourceTypes lists both resource types', async () => {
      const { app } = await buildApp();
      const res = await get(app, '/ResourceTypes');
      expect(json(res).Resources.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining(['User', 'Group']));
    });

    it('GET /ResourceTypes/User returns one resource type', async () => {
      const { app } = await buildApp();
      const res = await get(app, '/ResourceTypes/User');
      expect(res.statusCode).toBe(200);
      expect(json(res).id).toBe('User');
      expect(json(res).endpoint).toBe('/Users');
    });
  });

  describe('Authentication & scopes', () => {
    it('returns 401 when the session is invalid', async () => {
      const { app } = await buildApp({ authenticated: false });
      const res = await get(app, '/Users');
      expect(res.statusCode).toBe(401);
      expect(res.headers['content-type']).toContain(SCIM_MEDIA_TYPE);
      expect(json(res).schemas).toEqual([ScimErrorSchema]);
      expect(res.headers['www-authenticate']).toContain('Bearer');
    });

    it('returns 403 with insufficientScope when scope is missing', async () => {
      const { app } = await buildApp({ scopes: ['something-else'] });
      const res = await get(app, '/Users');
      expect(res.statusCode).toBe(403);
      expect(json(res).scimType).toBe('insufficientScope');
    });

    it('honours the wildcard "*" scope', async () => {
      const { app } = await buildApp({ scopes: ['*'] });
      expect((await get(app, '/Users')).statusCode).toBe(200);
    });
  });

  describe('Errors', () => {
    it('uniqueness conflict returns SCIM error with scimType', async () => {
      const { app } = await buildApp();
      await post(app, '/Users', { userName: 'dup' });
      const res = await post(app, '/Users', { userName: 'dup' });
      expect(res.statusCode).toBe(409);
      expect(json(res)).toMatchObject({ schemas: [ScimErrorSchema], status: '409', scimType: 'uniqueness' });
    });

    it('unsupported content type returns 415 SCIM envelope', async () => {
      const { app } = await buildApp();
      const res = await send(app, 'POST', '/Users', 'not json', 'text/plain');
      expect(res.statusCode).toBe(415);
      expect(res.headers['content-type']).toContain(SCIM_MEDIA_TYPE);
      expect(json(res).schemas).toEqual([ScimErrorSchema]);
    });

    it('invalid filter returns 400 invalidFilter', async () => {
      const { app } = await buildApp();
      const res = await get(app, '/Users?filter=' + encodeURIComponent('userName "bjensen"'));
      expect(res.statusCode).toBe(400);
      expect(json(res).scimType).toBe('invalidFilter');
    });

    it('renders an unexpected error as a generic 500 envelope', async () => {
      const { app, userRepository } = await buildApp();
      userRepository.list = async () => {
        throw new Error('database exploded');
      };
      const res = await get(app, '/Users');
      expect(res.statusCode).toBe(500);
      expect(json(res)).toEqual({ schemas: [ScimErrorSchema], status: '500', detail: 'Internal Server Error' });
    });
  });

  describe('Mounting under a prefix', () => {
    it('serves the endpoints under the prefix', async () => {
      const { app } = await buildApp({ prefix: '/scim/v2' });
      expect((await get(app, '/scim/v2/ServiceProviderConfig')).statusCode).toBe(200);
      expect((await post(app, '/scim/v2/Users', { userName: 'bjensen' })).statusCode).toBe(201);
    });

    it('answers an unknown path under the prefix with a SCIM 404 envelope', async () => {
      const { app } = await buildApp({ prefix: '/scim/v2' });
      const res = await get(app, '/scim/v2/Nope?secret=1');
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain(SCIM_MEDIA_TYPE);
      expect(json(res)).toEqual({ schemas: [ScimErrorSchema], status: '404', detail: 'Not Found: /scim/v2/Nope' });
    });

    it('leaves paths outside the prefix to the app not-found handler', async () => {
      const { app } = await buildApp({ prefix: '/scim/v2' });
      const res = await get(app, '/elsewhere');
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).not.toContain(SCIM_MEDIA_TYPE);
    });
  });

  describe('Plain Fastify (no ServerKit plugins)', () => {
    const buildPlainApp = async () => {
      const services = createServices();
      const app = Fastify();
      app.decorateRequest('authenticationSession', undefined as unknown as AuthenticationSession);
      app.addHook('onRequest', async request => {
        request.authenticationSession = sessionFor({});
      });
      await app.register(scimRoutes({ ...services, routeGuards: [requireScimScope('scim')] }), { prefix: '/scim' });
      await app.ready();
      return app;
    };

    it('parses application/scim+json bodies with its scoped parser', async () => {
      const app = await buildPlainApp();
      const res = await post(app, '/scim/Users', { userName: 'bjensen' });
      expect(res.statusCode).toBe(201);
      expect(json(res).userName).toBe('bjensen');
    });

    it('renders malformed JSON as a 400 SCIM envelope', async () => {
      const app = await buildPlainApp();
      const res = await send(app, 'POST', '/scim/Users', '{not json');
      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain(SCIM_MEDIA_TYPE);
      expect(json(res).schemas).toEqual([ScimErrorSchema]);
    });

    it('renders an unsupported media type as a 415 SCIM envelope', async () => {
      const app = await buildPlainApp();
      const res = await send(app, 'POST', '/scim/Users', 'x', 'text/csv');
      expect(res.statusCode).toBe(415);
      expect(json(res).schemas).toEqual([ScimErrorSchema]);
    });

    it('rejects a request with no session as 401', async () => {
      const services = createServices();
      const app = Fastify();
      await app.register(scimRoutes({ ...services, routeGuards: [requireScimScope('scim')] }));
      const res = await app.inject({ method: 'GET', url: '/Users' });
      expect(res.statusCode).toBe(401);
      expect(json(res).schemas).toEqual([ScimErrorSchema]);
    });
  });
});
