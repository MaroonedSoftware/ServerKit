import { describe, it, expect } from 'vitest';
import { bodyParserMiddleware } from '../../../src/middleware/router/body.parser.middleware.js';
import { ServerKitRouter } from '../../../src/serverkit.router.js';
import { createTestApp } from '../../test.app.js';

const build = async (contentTypes: string[]) => {
  const { app, builder } = await createTestApp();
  builder.setupRoutes([
    ServerKitRouter().post('/', bodyParserMiddleware(contentTypes), async request => ({
      parsed: request.parsedBody ?? null,
      raw:
        typeof request.rawBody === 'string'
          ? request.rawBody
          : request.rawBody === undefined
            ? ''
            : Buffer.from(request.rawBody as Uint8Array).toString('utf8'),
    })),
  ]);
  return app;
};

describe('bodyParserMiddleware (fastify)', () => {
  it('parses JSON into parsedBody and keeps the raw bytes', async () => {
    const app = await build(['application/json']);

    const response = await app.inject({ method: 'POST', url: '/', headers: { 'content-type': 'application/json' }, payload: '{"a":1}' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ parsed: { a: 1 }, raw: '{"a":1}' });
  });

  it('parses url-encoded forms', async () => {
    const app = await build(['application/x-www-form-urlencoded']);

    const response = await app.inject({
      method: 'POST',
      url: '/',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'a=1&b=x',
    });

    expect(response.json()).toEqual({ parsed: { a: '1', b: 'x' }, raw: 'a=1&b=x' });
  });

  it('parses text', async () => {
    const app = await build(['text/plain']);

    const response = await app.inject({ method: 'POST', url: '/', headers: { 'content-type': 'text/plain' }, payload: 'hello' });

    expect(response.json()).toEqual({ parsed: 'hello', raw: 'hello' });
  });

  it('resolves a +json subtype through the wildcard mapping', async () => {
    const app = await build(['application/vnd.api+json']);

    const response = await app.inject({ method: 'POST', url: '/', headers: { 'content-type': 'application/vnd.api+json' }, payload: '{"b":2}' });

    expect(response.json()).toEqual({ parsed: { b: 2 }, raw: '{"b":2}' });
  });

  it('rejects an unexpected body with 400 when no content types are allowed', async () => {
    const app = await build([]);

    const response = await app.inject({ method: 'POST', url: '/', headers: { 'content-type': 'application/json' }, payload: '{}' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ details: { body: 'Unexpected body' } });
  });

  it('lets a bodiless request through when no content types are allowed', async () => {
    const app = await build([]);

    const response = await app.inject({ method: 'POST', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ parsed: null, raw: '' });
  });

  it('rejects a missing body with 411 when one is required', async () => {
    const app = await build(['application/json']);

    const response = await app.inject({ method: 'POST', url: '/' });

    expect(response.statusCode).toBe(411);
  });

  it('rejects a disallowed content type with 415 and details', async () => {
    const app = await build(['application/json', 'text/plain']);

    const response = await app.inject({ method: 'POST', url: '/', headers: { 'content-type': 'text/xml' }, payload: '<a/>' });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ details: { 'content-type': 'must be one of application/json, text/plain', value: 'text/xml' } });
  });

  it('surfaces a parser HttpError (malformed JSON is a 400)', async () => {
    const app = await build(['application/json']);

    const response = await app.inject({ method: 'POST', url: '/', headers: { 'content-type': 'application/json' }, payload: '{nope' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an allowed type that has no registered parser with 415 from the dispatcher', async () => {
    const app = await build(['application/xml']);

    const response = await app.inject({ method: 'POST', url: '/', headers: { 'content-type': 'application/xml' }, payload: '<a/>' });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toMatchObject({ details: { body: 'Unsupported media type' } });
  });
});
