import { describe, it, expect } from 'vitest';
import { corsMiddleware, type CorsOptions } from '../../../src/middleware/server/cors.middleware.js';
import { errorMiddleware } from '../../../src/middleware/server/error.middleware.js';
import { serverKitContextMiddleware } from '../../../src/middleware/server/serverkit.context.middleware.js';
import { createTestApp } from '../../test.app.js';

const build = async (options?: CorsOptions) => {
  const { app } = await createTestApp({
    middleware: container => [errorMiddleware(container), serverKitContextMiddleware(container), corsMiddleware(options)],
  });
  app.get('/', async () => 'ok');
  app.post('/', async () => 'ok');
  return app;
};

const allowOrigin = (response: { headers: Record<string, unknown> }) => response.headers['access-control-allow-origin'];

describe('corsMiddleware (fastify)', () => {
  it('reflects any origin by default and advertises the default methods on preflight', async () => {
    const app = await build();

    const response = await app.inject({ method: 'GET', url: '/', headers: { origin: 'https://example.com' } });
    expect(response.statusCode).toBe(200);
    expect(allowOrigin(response)).toBe('https://example.com');

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/',
      headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-methods']).toBe('GET,HEAD,PUT,POST,DELETE,PATCH');
  });

  it('allows exact string origins and blocks others', async () => {
    const app = await build({ origin: ['https://api.example.com', 'https://admin.example.com'] });

    expect(allowOrigin(await app.inject({ method: 'GET', url: '/', headers: { origin: 'https://admin.example.com' } }))).toBe(
      'https://admin.example.com',
    );
    expect(allowOrigin(await app.inject({ method: 'GET', url: '/', headers: { origin: 'https://evil.example.com' } }))).toBeUndefined();
  });

  it('treats a bare string as one origin', async () => {
    const app = await build({ origin: 'https://single.example.com' });

    expect(allowOrigin(await app.inject({ method: 'GET', url: '/', headers: { origin: 'https://single.example.com' } }))).toBe(
      'https://single.example.com',
    );
    expect(allowOrigin(await app.inject({ method: 'GET', url: '/', headers: { origin: 'https://other.example.com' } }))).toBeUndefined();
  });

  it('matches RegExp origins', async () => {
    const app = await build({ origin: [/^https:\/\/.*\.example\.com$/] });

    expect(allowOrigin(await app.inject({ method: 'GET', url: '/', headers: { origin: 'https://app.example.com' } }))).toBe(
      'https://app.example.com',
    );
    expect(allowOrigin(await app.inject({ method: 'GET', url: '/', headers: { origin: 'https://example.org' } }))).toBeUndefined();
  });

  it('throws at construction when a wildcard origin is combined with credentials', () => {
    expect(() => corsMiddleware({ origin: '*', credentials: true })).toThrow(/credentials/);
    expect(() => corsMiddleware({ credentials: true })).toThrow(/credentials/);
    expect(() => corsMiddleware({ origin: 'https://app.example.com', credentials: true })).not.toThrow();
  });

  it('forwards methods and allowed headers to the preflight response', async () => {
    const app = await build({ methods: 'GET,POST', allowedHeaders: ['Content-Type', 'X-Custom'] });

    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/',
      headers: { origin: 'https://x.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'Content-Type, X-Custom' },
    });

    expect(preflight.headers['access-control-allow-methods']).toBe('GET,POST');
    expect(preflight.headers['access-control-allow-headers']).toBe('Content-Type, X-Custom');
  });

  it('exposes headers', async () => {
    const app = await build({ exposedHeaders: ['WWW-Authenticate'] });

    const response = await app.inject({ method: 'GET', url: '/', headers: { origin: 'https://x.com' } });

    expect(response.headers['access-control-expose-headers']).toBe('WWW-Authenticate');
  });
});
