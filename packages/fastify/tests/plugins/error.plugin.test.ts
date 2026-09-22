import { describe, it, expect } from 'vitest';
import { httpError, ServerkitError } from '@maroonedsoftware/errors';
import { errorPlugin, normalizeFastifyError } from '../../src/plugins/error.plugin.js';
import { serverKitContextPlugin } from '../../src/plugins/serverkit.context.plugin.js';
import { serverKitPlugin } from '../../src/serverkit.plugin.js';
import { createTestApp } from '../test.app.js';

describe('errorPlugin (fastify)', () => {
  it('renders an HttpError with its status, message, details, and headers', async () => {
    const { app, logger } = await createTestApp();
    const error = httpError(403).withDetails({ reason: 'nope' }).withHeaders({ 'www-authenticate': 'Bearer error="mfa_required"' });
    app.get('/', async () => {
      throw error;
    });

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ statusCode: 403, message: 'Forbidden', details: { reason: 'nope' } });
    expect(response.headers['www-authenticate']).toBe('Bearer error="mfa_required"');
    expect(logger.warn).toHaveBeenCalledWith(error, expect.objectContaining({ status: 403 }));
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('renders a bare ServerkitError as a 500 with its details', async () => {
    const { app } = await createTestApp();
    app.get('/', async () => {
      throw new ServerkitError('rule broken').withDetails({ rule: 'x' });
    });

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ statusCode: 500, message: 'rule broken', details: { rule: 'x' } });
  });

  it('renders a plain Error as a generic 500 with no details', async () => {
    const { app, logger } = await createTestApp();
    const error = new Error('secret internals');
    app.get('/', async () => {
      throw error;
    });

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ statusCode: 500, message: 'Internal Server Error' });
    expect(logger.error).toHaveBeenCalledWith(error, expect.objectContaining({ status: 500 }));
  });

  it('synthesises the 404 body for an unmatched route and warns', async () => {
    const { app, logger } = await createTestApp();

    const response = await app.inject({ method: 'GET', url: '/missing?x=1' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ statusCode: 404, message: 'Not Found', details: { url: 'http://localhost:80/missing?x=1' } });
    expect(logger.warn).toHaveBeenCalledWith(
      { statusCode: 404, message: 'Not Found', details: { url: 'http://localhost:80/missing' } },
      expect.objectContaining({ method: 'GET', path: '/missing', status: 404 }),
    );
  });

  it('logs the request method, path, status, and ids with the error', async () => {
    const { app, logger } = await createTestApp();
    const error = new Error('kaboom');
    app.get('/boom', async () => {
      throw error;
    });

    await app.inject({ method: 'GET', url: '/boom?token=secret', headers: { 'x-request-id': 'req-1', 'x-correlation-id': 'corr-1' } });

    expect(logger.error).toHaveBeenCalledWith(error, {
      method: 'GET',
      path: '/boom',
      status: 500,
      requestId: 'req-1',
      correlationId: 'corr-1',
    });
  });

  it('logs a 4xx at warn and a 5xx HttpError at error', async () => {
    const { app, logger } = await createTestApp();
    const tooMany = httpError(429);
    const unavailable = httpError(503);
    app.get('/limited', async () => {
      throw tooMany;
    });
    app.get('/down', async () => {
      throw unavailable;
    });

    await app.inject({ method: 'GET', url: '/limited' });
    await app.inject({ method: 'GET', url: '/down' });

    expect(logger.warn).toHaveBeenCalledWith(tooMany, expect.objectContaining({ status: 429, path: '/limited' }));
    expect(logger.error).toHaveBeenCalledWith(unavailable, expect.objectContaining({ status: 503, path: '/down' }));
    expect(logger.error).not.toHaveBeenCalledWith(tooMany, expect.anything());
  });

  it('never logs the query string', async () => {
    const { app, logger } = await createTestApp();
    app.get('/boom', async () => {
      throw httpError(401);
    });

    await app.inject({ method: 'GET', url: '/boom?token=secret' });
    await app.inject({ method: 'GET', url: '/missing?token=secret' });

    expect(JSON.stringify([logger.warn, logger.error].map(fn => (fn as unknown as { mock: { calls: unknown[] } }).mock.calls))).not.toContain(
      'secret',
    );
  });

  it('maps a Fastify-raised 4xx (malformed JSON in a Fastify parser) to an HttpError with the reason as a detail', async () => {
    // No body parser plugin here: this is about how a Fastify-raised error renders, so Fastify's
    // own parsers are left in place rather than replaced by ServerKit's.
    const { app } = await createTestApp({ plugins: container => [errorPlugin(container), serverKitContextPlugin(container)] });
    // Register Fastify's own strict JSON parser on one type so its 400 surfaces.
    app.addContentTypeParser('application/strict+json', { parseAs: 'string' }, app.getDefaultJsonParser('error', 'error'));
    app.post('/', async () => 'ok');

    const response = await app.inject({ method: 'POST', url: '/', headers: { 'content-type': 'application/strict+json' }, payload: '{bad' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ statusCode: 400, message: 'Bad Request', details: { reason: expect.stringContaining('JSON') } });
  });

  it('renders an error thrown before the context hook through the root logger', async () => {
    const { app, logger } = await createTestApp({
      plugins: container => [
        errorPlugin(container),
        serverKitPlugin('throws', async app =>
          app.addHook('onRequest', async () => {
            throw httpError(418);
          }),
        ),
      ],
    });
    app.get('/', async () => 'ok');

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(418);
    expect(logger.warn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 418, requestId: expect.any(String) }));
  });
});

describe('normalizeFastifyError', () => {
  it('passes ServerKit and unknown errors through untouched', () => {
    const error = new ServerkitError('x');
    expect(normalizeFastifyError(error)).toBe(error);
    const plain = new Error('y');
    expect(normalizeFastifyError(plain)).toBe(plain);
    expect(normalizeFastifyError('str')).toBe('str');
  });

  it('leaves a Fastify 5xx untouched so it renders as a generic 500', () => {
    const error = Object.assign(new Error('boom'), { code: 'FST_ERR_INTERNAL', statusCode: 500 });
    expect(normalizeFastifyError(error)).toBe(error);
  });

  it('maps a Fastify 4xx to an HttpError carrying the message as reason', () => {
    const error = Object.assign(new Error('body must be object'), { code: 'FST_ERR_VALIDATION', statusCode: 400 });
    expect(normalizeFastifyError(error)).toMatchObject({ statusCode: 400, details: { reason: 'body must be object' }, cause: error });
  });
});
