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
    expect(logger.error).toHaveBeenCalledWith(error);
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
    expect(logger.error).toHaveBeenCalledWith(error);
  });

  it('synthesises the 404 body for an unmatched route and warns', async () => {
    const { app, logger } = await createTestApp();

    const response = await app.inject({ method: 'GET', url: '/missing?x=1' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ statusCode: 404, message: 'Not Found', details: { url: 'http://localhost:80/missing?x=1' } });
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
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
    expect(logger.error).toHaveBeenCalled();
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
