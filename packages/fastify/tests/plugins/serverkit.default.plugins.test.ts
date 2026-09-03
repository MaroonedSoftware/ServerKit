import { describe, it, expect, vi } from 'vitest';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import { AuthenticationSchemeHandler, invalidAuthenticationSession } from '@maroonedsoftware/authentication';
import { RateLimiter, type ServerKitModule } from '@maroonedsoftware/servercore';
import { serverKitDefaultPlugins } from '../../src/plugins/serverkit.default.plugins.js';
import { createTestApp } from '../test.app.js';

const schemeModule = (handle = vi.fn(async () => invalidAuthenticationSession)): ServerKitModule => ({
  name: 'auth',
  setup: async registry => void registry.register(AuthenticationSchemeHandler).useInstance({ handle } as unknown as AuthenticationSchemeHandler),
});

describe('serverKitDefaultPlugins (fastify)', () => {
  it('builds error, context, body parser, cors, and authentication when no RateLimiter is registered', async () => {
    const handle = vi.fn(async () => invalidAuthenticationSession);
    const { app, container } = await createTestApp({ modules: [schemeModule(handle)], plugins: serverKitDefaultPlugins });
    app.get('/', async request => ({ requestId: request.requestId, session: request.authenticationSession === invalidAuthenticationSession }));

    expect(serverKitDefaultPlugins(container)).toHaveLength(5);

    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { origin: 'https://x.com', 'x-request-id': 'r1', authorization: 'Bearer t' },
    });
    expect(response.json()).toEqual({ requestId: 'r1', session: true });
    expect(response.headers['access-control-allow-origin']).toBe('https://x.com');
    expect(response.headers['access-control-expose-headers']).toBe('WWW-Authenticate');
    expect(handle).toHaveBeenCalledWith('Bearer t');
  });

  it('inserts the rate limiter when one is registered', async () => {
    const limiter = new RateLimiterMemory({ points: 1, duration: 60 });
    const limiterModule: ServerKitModule = { name: 'limits', setup: async registry => void registry.register(RateLimiter).useInstance(limiter) };
    const { app, container } = await createTestApp({ modules: [schemeModule(), limiterModule], plugins: serverKitDefaultPlugins });
    app.get('/', async () => 'ok');

    expect(serverKitDefaultPlugins(container)).toHaveLength(6);
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(429);
  });

  it('forwards authentication options', async () => {
    const handle = vi.fn(async () => invalidAuthenticationSession);
    const { app } = await createTestApp({
      modules: [schemeModule(handle)],
      plugins: container => serverKitDefaultPlugins(container, { authentication: { anonymousPaths: ['/health'] } }),
    });
    app.get('/health', async () => 'ok');

    await app.inject({ method: 'GET', url: '/health' });

    expect(handle).not.toHaveBeenCalled();
  });

  it('answers a CORS preflight before authentication runs', async () => {
    const handle = vi.fn(async () => invalidAuthenticationSession);
    const { app } = await createTestApp({ modules: [schemeModule(handle)], plugins: serverKitDefaultPlugins });
    app.post('/', async () => 'ok');

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/',
      headers: { origin: 'https://x.com', 'access-control-request-method': 'POST' },
    });

    expect(preflight.statusCode).toBe(204);
    expect(handle).not.toHaveBeenCalled();
  });
});
