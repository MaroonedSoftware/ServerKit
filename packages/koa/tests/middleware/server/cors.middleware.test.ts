import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import Koa from 'koa';
import { corsMiddleware, type CorsOptions } from '../../../src/middleware/server/cors.middleware.js';

// Each test mounts corsMiddleware on a real Koa app behind a real HTTP server,
// then issues real fetch requests so we observe the actual Access-Control-* headers
// emitted by @koa/cors rather than asserting against a no-op stub.

type AppHandle = { url: string; close: () => Promise<void> };

const startApp = async (options?: CorsOptions): Promise<AppHandle> => {
  const app = new Koa();
  app.use(corsMiddleware(options));
  app.use(ctx => {
    ctx.status = 200;
    ctx.body = 'ok';
  });

  const server = http.createServer(app.callback());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve()))),
  };
};

describe('corsMiddleware', () => {
  describe('return value', () => {
    it('returns a 2-arg middleware function', () => {
      const middleware = corsMiddleware();
      expect(middleware).toBeTypeOf('function');
      expect(middleware.length).toBe(2);
    });
  });

  describe('default options (origin: ["*"])', () => {
    let app: AppHandle;
    beforeAll(async () => {
      app = await startApp();
    });
    afterAll(async () => {
      await app.close();
    });

    it('echoes the request Origin in Access-Control-Allow-Origin', async () => {
      const res = await fetch(app.url, { headers: { Origin: 'https://example.com' } });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://example.com');
    });

    it('advertises the default method allow-list on a preflight', async () => {
      const res = await fetch(app.url, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'POST',
        },
      });
      expect(res.headers.get('access-control-allow-methods')).toBe('GET,HEAD,PUT,POST,DELETE,PATCH');
    });
  });

  describe('exact-string origin allow-list', () => {
    let app: AppHandle;
    beforeAll(async () => {
      app = await startApp({ origin: ['https://api.example.com', 'https://admin.example.com'] });
    });
    afterAll(async () => {
      await app.close();
    });

    it('allows an origin that exactly matches', async () => {
      const res = await fetch(app.url, { headers: { Origin: 'https://api.example.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://api.example.com');
    });

    it('allows the second origin in the list', async () => {
      const res = await fetch(app.url, { headers: { Origin: 'https://admin.example.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://admin.example.com');
    });

    it('does not echo the origin when it is not on the list', async () => {
      const res = await fetch(app.url, { headers: { Origin: 'https://evil.example.com' } });
      // Falsy origin from the matcher → @koa/cors omits the header (or returns empty).
      const allow = res.headers.get('access-control-allow-origin');
      expect(allow === null || allow === '').toBe(true);
    });
  });

  describe('regexp origin matcher', () => {
    let app: AppHandle;
    beforeAll(async () => {
      app = await startApp({ origin: [/^https:\/\/.*\.example\.com$/] });
    });
    afterAll(async () => {
      await app.close();
    });

    it('allows an origin that matches the pattern', async () => {
      const res = await fetch(app.url, { headers: { Origin: 'https://app.example.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    });

    it('rejects an origin that does not match the pattern', async () => {
      const res = await fetch(app.url, { headers: { Origin: 'https://example.org' } });
      const allow = res.headers.get('access-control-allow-origin');
      expect(allow === null || allow === '').toBe(true);
    });
  });

  describe('mixed string + regexp matchers', () => {
    let app: AppHandle;
    beforeAll(async () => {
      app = await startApp({ origin: ['https://a.com', /^https:\/\/b\.com$/, 'https://c.com'] });
    });
    afterAll(async () => {
      await app.close();
    });

    it('matches via the regex when the string entries miss', async () => {
      const res = await fetch(app.url, { headers: { Origin: 'https://b.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://b.com');
    });

    it('matches the trailing string entry', async () => {
      const res = await fetch(app.url, { headers: { Origin: 'https://c.com' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('https://c.com');
    });
  });

  describe('custom @koa/cors options', () => {
    let app: AppHandle;
    beforeAll(async () => {
      app = await startApp({
        allowMethods: 'GET,POST',
        allowHeaders: ['Content-Type', 'X-Custom'],
      });
    });
    afterAll(async () => {
      await app.close();
    });

    it('forwards allowMethods to the preflight response', async () => {
      const res = await fetch(app.url, {
        method: 'OPTIONS',
        headers: { Origin: 'https://x.com', 'Access-Control-Request-Method': 'POST' },
      });
      expect(res.headers.get('access-control-allow-methods')).toBe('GET,POST');
    });

    it('forwards allowHeaders to the preflight response', async () => {
      const res = await fetch(app.url, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://x.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, X-Custom',
        },
      });
      expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type,X-Custom');
    });
  });

  it('passes the request through to downstream handlers', async () => {
    const app = await startApp();
    try {
      const res = await fetch(app.url, { headers: { Origin: 'https://example.com' } });
      const body = await res.text();
      expect(body).toBe('ok');
    } finally {
      await app.close();
    }
  });
});
