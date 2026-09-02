import { describe, it, expect } from 'vitest';
import { sendJson } from '../src/send.json.js';
import { ServerKitRouter } from '../src/serverkit.router.js';
import { createTestApp } from './test.app.js';

describe('sendJson (fastify)', () => {
  it('sends the string verbatim as application/json with the default status', async () => {
    const { app, builder } = await createTestApp();
    builder.setupRoutes([ServerKitRouter().get('/', async (_request, reply) => sendJson(reply, '{"a":1}'))]);

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).toBe('{"a":1}');
  });

  it('honors a custom status', async () => {
    const { app, builder } = await createTestApp();
    builder.setupRoutes([ServerKitRouter().post('/', async (_request, reply) => sendJson(reply, '{"created":true}', 201))]);

    const response = await app.inject({ method: 'POST', url: '/' });

    expect(response.statusCode).toBe(201);
    expect(response.body).toBe('{"created":true}');
  });
});
