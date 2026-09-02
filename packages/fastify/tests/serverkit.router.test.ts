import { describe, it, expect } from 'vitest';
import { httpError } from '@maroonedsoftware/errors';
import { ServerKitRouter } from '../src/serverkit.router.js';
import type { ServerKitRouterMiddleware } from '../src/serverkit.middleware.js';
import { createTestApp } from './test.app.js';

describe('ServerKitRouter (fastify)', () => {
  it('registers every method and returns the router for chaining', async () => {
    const { app, builder } = await createTestApp();
    const router = ServerKitRouter();
    const result = router
      .get('/r', async () => 'get')
      .post('/r', async () => 'post')
      .put('/r', async () => 'put')
      .patch('/r', async () => 'patch')
      .delete('/r', async () => 'delete')
      .options('/r', async () => 'options')
      .head('/h', async (_request, reply) => reply.send());
    builder.setupRoutes([router]);

    expect(result).toBe(router);
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
      expect((await app.inject({ method, url: '/r' })).body).toBe(method.toLowerCase());
    }
    expect((await app.inject({ method: 'HEAD', url: '/h' })).statusCode).toBe(200);
  });

  it('runs router-level guards before route-level guards, then the handler', async () => {
    const { app, builder } = await createTestApp();
    const order: string[] = [];
    const guard =
      (name: string): ServerKitRouterMiddleware =>
      async () => {
        order.push(name);
      };
    const router = ServerKitRouter().use(guard('router-a'), guard('router-b'));
    router.get('/', guard('route-a'), guard('route-b'), async () => {
      order.push('handler');
      return 'ok';
    });
    builder.setupRoutes([router]);

    await app.inject({ method: 'GET', url: '/' });

    expect(order).toEqual(['router-a', 'router-b', 'route-a', 'route-b', 'handler']);
  });

  it('applies guards added with use() after the routes were defined', async () => {
    const { app, builder } = await createTestApp();
    const router = ServerKitRouter().get('/', async () => 'ok');
    router.use(async () => {
      throw httpError(401);
    });
    builder.setupRoutes([router]);

    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(401);
  });

  it('stops at a guard that throws and renders the error', async () => {
    const { app, builder } = await createTestApp();
    let handled = false;
    const router = ServerKitRouter().get(
      '/',
      async () => {
        throw httpError(403);
      },
      async () => {
        handled = true;
        return 'ok';
      },
    );
    builder.setupRoutes([router]);

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(403);
    expect(handled).toBe(false);
  });

  it('exposes the prefix for the builder to mount under', async () => {
    const { app, builder } = await createTestApp();
    const router = ServerKitRouter({ prefix: '/v1' }).get('/users', async () => ['a']);
    builder.setupRoutes([router]);

    expect(router.prefix).toBe('/v1');
    expect((await app.inject({ method: 'GET', url: '/v1/users' })).json()).toEqual(['a']);
  });

  it('gives handlers the ServerKit context and the reply', async () => {
    const { app, builder } = await createTestApp();
    const router = ServerKitRouter().get('/', async (request, reply) => {
      void reply.header('x-seen', request.requestId);
      return { id: request.requestId };
    });
    builder.setupRoutes([router]);

    const response = await app.inject({ method: 'GET', url: '/', headers: { 'x-request-id': 'abc' } });

    expect(response.headers['x-seen']).toBe('abc');
    expect(response.json()).toEqual({ id: 'abc' });
  });
});
