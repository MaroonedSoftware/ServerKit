import { describe, it, expect } from 'vitest';
import { bodyParserPlugin } from '../../src/plugins/body.parser.plugin.js';
import { errorPlugin } from '../../src/plugins/error.plugin.js';
import { serverKitContextPlugin } from '../../src/plugins/serverkit.context.plugin.js';
import { createTestApp, type TestAppOptions } from '../test.app.js';

const plugins: TestAppOptions['plugins'] = container => [errorPlugin(container), serverKitContextPlugin(container), bodyParserPlugin()];

/** A POST route accepting `body` content types, echoing what the parser produced. */
const build = async (body?: string[]) => {
  const { app } = await createTestApp({ plugins });
  app.post('/', { config: body === undefined ? {} : { body } }, async request => ({
    parsed: request.body ?? null,
    raw:
      typeof request.rawBody === 'string'
        ? request.rawBody
        : request.rawBody === undefined
          ? ''
          : Buffer.from(request.rawBody as Uint8Array).toString('utf8'),
  }));
  return app;
};

describe('bodyParserPlugin', () => {
  it('parses JSON onto request.body and keeps the raw bytes', async () => {
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

  it('hands a multipart body over unread, as the lazy MultipartBody the parser returns', async () => {
    const { app } = await createTestApp({ plugins });
    app.post('/upload', { config: { body: ['multipart/form-data'] } }, async request => {
      const body = request.body as { parse?: unknown };
      // The parser wraps the stream rather than consuming it: `parse` is MultipartBody's own
      // reader, and the stream is still unread when the handler runs.
      return { lazy: typeof body.parse === 'function', consumed: request.raw.readableEnded };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/upload',
      headers: { 'content-type': 'multipart/form-data; boundary=xyz' },
      payload: '--xyz\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--xyz--\r\n',
    });

    expect(response.json()).toEqual({ lazy: true, consumed: false });
  });

  it('rejects an unexpected body with 400 when the route declares no content types', async () => {
    const app = await build();

    const response = await app.inject({ method: 'POST', url: '/', headers: { 'content-type': 'application/json' }, payload: '{}' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ details: { body: 'Unexpected body' } });
  });

  it('lets a bodiless request through when the route declares no content types', async () => {
    const app = await build();

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

  it('rejects a body on a GET route that declares no content types', async () => {
    const { app } = await createTestApp({ plugins });
    app.get('/read', async () => 'ok');

    const response = await app.inject({ method: 'GET', url: '/read', headers: { 'content-type': 'application/json' }, payload: '{"a":1}' });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ details: { body: 'Unexpected body' } });
  });

  it('leaves request.body undefined on a bodyless method, even when the route allows a body', async () => {
    const { app } = await createTestApp({ plugins });
    app.get('/read', { config: { body: ['application/json'] } }, async request => ({ body: request.body ?? null }));

    const response = await app.inject({ method: 'GET', url: '/read', headers: { 'content-type': 'application/json' } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ body: null });
  });

  it('answers 404, not 400, for a body posted to an unrouted url', async () => {
    const app = await build(['application/json']);

    const response = await app.inject({ method: 'POST', url: '/nowhere', headers: { 'content-type': 'application/json' }, payload: '{"a":1}' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ statusCode: 404, message: 'Not Found' });
  });

  it('rejects an oversized body with 413 from the declared content length', async () => {
    const { app } = await createTestApp({ plugins });
    app.post('/small', { bodyLimit: 16, config: { body: ['application/json'] } }, async () => 'ok');

    const response = await app.inject({
      method: 'POST',
      url: '/small',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ padding: 'x'.repeat(64) }),
    });

    expect(response.statusCode).toBe(413);
  });

  it('names the wiring mistake when a route declares a body schema but accepts no body', async () => {
    const { app, logger } = await createTestApp({ plugins });
    app.post('/typed', { schema: { body: { type: 'object' } } }, async () => 'ok');

    const response = await app.inject({ method: 'POST', url: '/typed', headers: { 'content-type': 'application/json' }, payload: '{}' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ message: expect.stringContaining('config.body') });
    expect(logger.error).toHaveBeenCalled();
  });
});
