import { describe, expect, it } from 'vitest';
import Koa from 'koa';
import request from 'supertest';
import { InjectKitRegistry } from 'injectkit';
import type { IncomingMessage } from 'node:http';
import { Logger } from '@maroonedsoftware/logger';
import {
  ServerKitBodyParser,
  ServerKitParser,
  ServerKitParserMappings,
  type ServerKitParserResult,
  serverKitContextMiddleware,
} from '@maroonedsoftware/koa';
import { type AuthenticationSession, invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { createScimRouter } from '../src/router/scim.router.js';
import { ScimUserService } from '../src/services/scim.user.service.js';
import { ScimGroupService } from '../src/services/scim.group.service.js';
import { ScimServiceProviderService } from '../src/services/scim.service.provider.service.js';
import { scimErrorMiddleware } from '../src/middleware/scim.error.middleware.js';
import { requireScimScope } from '../src/middleware/require.scim.scope.middleware.js';
import { SCIM_MEDIA_TYPE } from '../src/middleware/scim.content.type.middleware.js';
import { UserSchemaId } from '../src/schemas/user.schema.js';
import { ListResponseSchema } from '../src/types/list.response.js';
import { PatchOpSchema } from '../src/types/patch.op.js';
import { ScimErrorSchema } from '../src/errors/scim.error.js';
import { InMemoryGroupRepository, InMemoryUserRepository, silentLogger } from './in.memory.repos.js';

/** Minimal in-test JSON parser that reads the request stream. */
class TestJsonParser extends ServerKitParser {
  async parse(req: IncomingMessage): Promise<ServerKitParserResult> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const parsed = raw.length > 0 ? JSON.parse(raw) : {};
    return { parsed, raw };
  }
}

const buildApp = (options: { authenticated?: boolean; scopes?: string[] } = {}) => {
  const userRepository = new InMemoryUserRepository();
  const groupRepository = new InMemoryGroupRepository();

  const registry = new InjectKitRegistry();
  registry.register(Logger).useInstance(silentLogger as unknown as Logger);
  const mappings = new ServerKitParserMappings();
  const parser = new TestJsonParser();
  // `request.is(...)` returns the input string for explicit MIME types but
  // returns the request's actual content-type for `+json`/`*` shortcuts, so
  // the map keys must match those literal values.
  mappings.set('json', parser);
  mappings.set('application/scim+json', parser);
  registry.register(ServerKitBodyParser).useInstance(new ServerKitBodyParser(mappings));
  const container = registry.build();

  const userService = new ScimUserService(userRepository, silentLogger);
  const groupService = new ScimGroupService(groupRepository, silentLogger);
  const serviceProviderService = new ScimServiceProviderService();

  const router = createScimRouter({
    userService,
    groupService,
    serviceProviderService,
    routeGuards: [requireScimScope('scim')],
  });

  const app = new Koa();
  app.use(scimErrorMiddleware());
  app.use(serverKitContextMiddleware(container));
  // Inject a fake authentication session before the router.
  app.use(async (ctx, next) => {
    if (options.authenticated === false) {
      ctx.authenticationSession = invalidAuthenticationSession;
    } else {
      // requireScimScope only inspects `claims.scimScopes`, so the rest of the
      // session fields are irrelevant for these tests.
      ctx.authenticationSession = {
        sessionToken: 'test',
        subject: 'tester',
        factors: [],
        claims: { scimScopes: options.scopes ?? ['scim'] },
      } as unknown as AuthenticationSession;
    }
    await next();
  });
  app.use(router.routes());
  app.use(router.allowedMethods());

  return { app, userRepository, groupRepository };
};

describe('createScimRouter — integration', () => {
  describe('Users', () => {
    it('creates a user and returns 201 with Location', async () => {
      const { app } = buildApp();
      const res = await request(app.callback())
        .post('/Users')
        .set('Content-Type', SCIM_MEDIA_TYPE)
        .send({ schemas: [UserSchemaId], userName: 'bjensen' });
      expect(res.status).toBe(201);
      expect(res.headers['content-type']).toContain(SCIM_MEDIA_TYPE);
      expect(res.headers['location']).toMatch(/^\/Users\//);
      expect(res.body.userName).toBe('bjensen');
      expect(res.body.id).toBeDefined();
      expect(res.body.meta.resourceType).toBe('User');
    });

    it('GET /Users lists in a SCIM ListResponse envelope', async () => {
      const { app } = buildApp();
      await request(app.callback()).post('/Users').set('Content-Type', SCIM_MEDIA_TYPE).send({ userName: 'a' });
      await request(app.callback()).post('/Users').set('Content-Type', SCIM_MEDIA_TYPE).send({ userName: 'b' });
      const res = await request(app.callback()).get('/Users');
      expect(res.status).toBe(200);
      expect(res.body.schemas).toEqual([ListResponseSchema]);
      expect(res.body.totalResults).toBe(2);
      expect(res.body.itemsPerPage).toBe(2);
      expect(res.body.Resources).toHaveLength(2);
    });

    it('GET /Users with filter narrows the result set', async () => {
      const { app } = buildApp();
      await request(app.callback()).post('/Users').set('Content-Type', SCIM_MEDIA_TYPE).send({ userName: 'alice' });
      await request(app.callback()).post('/Users').set('Content-Type', SCIM_MEDIA_TYPE).send({ userName: 'bob' });
      const res = await request(app.callback()).get('/Users?filter=' + encodeURIComponent('userName eq "alice"'));
      expect(res.status).toBe(200);
      expect(res.body.totalResults).toBe(1);
      expect(res.body.Resources[0].userName).toBe('alice');
    });

    it('POST /Users/.search accepts the filter in the body', async () => {
      const { app } = buildApp();
      await request(app.callback()).post('/Users').set('Content-Type', SCIM_MEDIA_TYPE).send({ userName: 'alice' });
      const res = await request(app.callback()).post('/Users/.search').set('Content-Type', SCIM_MEDIA_TYPE).send({ filter: 'userName eq "alice"' });
      expect(res.status).toBe(200);
      expect(res.body.totalResults).toBe(1);
    });

    it('PATCH replaces a user attribute', async () => {
      const { app } = buildApp();
      const created = await request(app.callback()).post('/Users').set('Content-Type', SCIM_MEDIA_TYPE).send({ userName: 'bjensen' });
      const id = created.body.id;
      const res = await request(app.callback())
        .patch(`/Users/${id}`)
        .set('Content-Type', SCIM_MEDIA_TYPE)
        .send({ schemas: [PatchOpSchema], Operations: [{ op: 'add', path: 'displayName', value: 'Barbara' }] });
      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('Barbara');
    });

    it('DELETE /Users/:id returns 204', async () => {
      const { app, userRepository } = buildApp();
      const created = await request(app.callback()).post('/Users').set('Content-Type', SCIM_MEDIA_TYPE).send({ userName: 'bjensen' });
      const res = await request(app.callback()).delete(`/Users/${created.body.id}`);
      expect(res.status).toBe(204);
      expect(userRepository.users.size).toBe(0);
    });

    it('GET /Users/:id 404 returns SCIM error envelope', async () => {
      const { app } = buildApp();
      const res = await request(app.callback()).get('/Users/missing');
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toContain(SCIM_MEDIA_TYPE);
      expect(res.body).toMatchObject({
        schemas: [ScimErrorSchema],
        status: '404',
      });
      // Provisioning clients surface `detail` to the operator, so it has to name the resource.
      expect(res.body.detail).toContain('missing');
    });

    it('POST /Users 409 explains which userName collided', async () => {
      const { app } = buildApp();
      await request(app.callback()).post('/Users').set('Content-Type', SCIM_MEDIA_TYPE).send({ userName: 'bjensen' });
      const res = await request(app.callback()).post('/Users').set('Content-Type', SCIM_MEDIA_TYPE).send({ userName: 'bjensen' });

      expect(res.status).toBe(409);
      expect(res.body.scimType).toBe('uniqueness');
      expect(res.body.detail).toContain('bjensen');
    });

    it('GET /Users?count=0 returns no resources but still reports totalResults', async () => {
      // The connection-setup probe Okta and Entra make: "how many users are there?"
      const { app } = buildApp();
      await request(app.callback()).post('/Users').set('Content-Type', SCIM_MEDIA_TYPE).send({ userName: 'alice' });
      await request(app.callback()).post('/Users').set('Content-Type', SCIM_MEDIA_TYPE).send({ userName: 'bob' });

      const res = await request(app.callback()).get('/Users?count=0');

      expect(res.status).toBe(200);
      expect(res.body.totalResults).toBe(2);
      expect(res.body.Resources).toEqual([]);
      expect(res.body.itemsPerPage).toBe(0);
    });

    it('GET /Users?count=0 agrees with the same count in a .search body', async () => {
      const { app } = buildApp();
      await request(app.callback()).post('/Users').set('Content-Type', SCIM_MEDIA_TYPE).send({ userName: 'alice' });

      const fromUrl = await request(app.callback()).get('/Users?count=0');
      const fromBody = await request(app.callback()).post('/Users/.search').set('Content-Type', SCIM_MEDIA_TYPE).send({ count: 0 });

      expect(fromUrl.body.Resources).toEqual(fromBody.body.Resources);
      expect(fromUrl.body.totalResults).toBe(fromBody.body.totalResults);
    });

    it('GET /Users falls back to the page size for a non-numeric count', async () => {
      const { app } = buildApp();
      await request(app.callback()).post('/Users').set('Content-Type', SCIM_MEDIA_TYPE).send({ userName: 'alice' });

      const res = await request(app.callback()).get('/Users?count=notanumber');

      expect(res.status).toBe(200);
      expect(res.body.Resources).toHaveLength(1);
    });

    it('never returns password, even though the repository stored it', async () => {
      const { app } = buildApp();
      const created = await request(app.callback())
        .post('/Users')
        .set('Content-Type', SCIM_MEDIA_TYPE)
        .send({ userName: 'bjensen', password: 'hunter2' });

      expect(created.body.password).toBeUndefined();

      const fetched = await request(app.callback()).get(`/Users/${created.body.id}`);
      expect(fetched.body.password).toBeUndefined();

      const listed = await request(app.callback()).get('/Users');
      expect(listed.body.Resources[0].password).toBeUndefined();
    });

    it('GET /Users/:id?attributes= returns only the requested attributes plus the core ones', async () => {
      const { app } = buildApp();
      const created = await request(app.callback())
        .post('/Users')
        .set('Content-Type', SCIM_MEDIA_TYPE)
        .send({ userName: 'bjensen', displayName: 'Barbara Jensen' });

      const res = await request(app.callback()).get(`/Users/${created.body.id}?attributes=userName`);

      expect(res.body.userName).toBe('bjensen');
      expect(res.body.displayName).toBeUndefined();
      expect(res.body.id).toBe(created.body.id);
      expect(res.body.schemas).toBeDefined();
    });

    it('GET /Users?excludedAttributes= omits the named attribute from every resource', async () => {
      const { app } = buildApp();
      await request(app.callback())
        .post('/Users')
        .set('Content-Type', SCIM_MEDIA_TYPE)
        .send({ userName: 'bjensen', displayName: 'Barbara Jensen' });

      const res = await request(app.callback()).get('/Users?excludedAttributes=displayName');

      expect(res.body.Resources[0].userName).toBe('bjensen');
      expect(res.body.Resources[0].displayName).toBeUndefined();
    });

    it('POST /Users/.search honours attributes from the request body', async () => {
      const { app } = buildApp();
      await request(app.callback())
        .post('/Users')
        .set('Content-Type', SCIM_MEDIA_TYPE)
        .send({ userName: 'bjensen', displayName: 'Barbara Jensen' });

      const res = await request(app.callback()).post('/Users/.search').set('Content-Type', SCIM_MEDIA_TYPE).send({ attributes: ['userName'] });

      expect(res.body.Resources[0].userName).toBe('bjensen');
      expect(res.body.Resources[0].displayName).toBeUndefined();
    });

    it('POST /Users 400 names the missing required attribute', async () => {
      const { app } = buildApp();
      const res = await request(app.callback()).post('/Users').set('Content-Type', SCIM_MEDIA_TYPE).send({});

      expect(res.status).toBe(400);
      expect(res.body.detail).toContain('userName');
    });
  });

  describe('Discovery', () => {
    it('GET /ServiceProviderConfig returns the config', async () => {
      const { app } = buildApp();
      const res = await request(app.callback()).get('/ServiceProviderConfig');
      expect(res.status).toBe(200);
      expect(res.body.patch.supported).toBe(true);
      expect(res.body.filter.supported).toBe(true);
    });

    it('GET /Schemas lists all schemas in a ListResponse', async () => {
      const { app } = buildApp();
      const res = await request(app.callback()).get('/Schemas');
      expect(res.status).toBe(200);
      expect(res.body.schemas).toEqual([ListResponseSchema]);
      expect(res.body.Resources.map((s: { id: string }) => s.id)).toContain(UserSchemaId);
    });

    it('GET /ResourceTypes/User returns one resource type', async () => {
      const { app } = buildApp();
      const res = await request(app.callback()).get('/ResourceTypes/User');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe('User');
      expect(res.body.endpoint).toBe('/Users');
    });
  });

  describe('Authentication & scopes', () => {
    it('returns 401 when the session is invalid', async () => {
      const { app } = buildApp({ authenticated: false });
      const res = await request(app.callback()).get('/Users');
      expect(res.status).toBe(401);
      expect(res.body.schemas).toEqual([ScimErrorSchema]);
      expect(res.headers['www-authenticate']).toContain('Bearer');
    });

    it('returns 403 with insufficientScope when scope is missing', async () => {
      const { app } = buildApp({ scopes: ['something-else'] });
      const res = await request(app.callback()).get('/Users');
      expect(res.status).toBe(403);
      expect(res.body.scimType).toBe('insufficientScope');
    });

    it('honours the wildcard "*" scope', async () => {
      const { app } = buildApp({ scopes: ['*'] });
      const res = await request(app.callback()).get('/Users');
      expect(res.status).toBe(200);
    });
  });

  describe('Errors', () => {
    it('uniqueness conflict returns SCIM error with scimType', async () => {
      const { app } = buildApp();
      await request(app.callback()).post('/Users').set('Content-Type', SCIM_MEDIA_TYPE).send({ userName: 'dup' });
      const res = await request(app.callback()).post('/Users').set('Content-Type', SCIM_MEDIA_TYPE).send({ userName: 'dup' });
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ schemas: [ScimErrorSchema], status: '409', scimType: 'uniqueness' });
    });

    it('unsupported content type returns 415 SCIM envelope', async () => {
      const { app } = buildApp();
      const res = await request(app.callback()).post('/Users').set('Content-Type', 'text/plain').send('not json');
      expect(res.status).toBe(415);
      expect(res.body.schemas).toEqual([ScimErrorSchema]);
    });

    it('invalid filter returns 400 invalidFilter', async () => {
      const { app } = buildApp();
      const res = await request(app.callback()).get('/Users?filter=' + encodeURIComponent('userName "bjensen"'));
      expect(res.status).toBe(400);
      expect(res.body.scimType).toBe('invalidFilter');
    });
  });
});
