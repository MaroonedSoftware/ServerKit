import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zodPlugin } from '../../src/zod/zod.plugin.js';
import type { ZodTypeProvider } from '../../src/zod/zod.type.provider.js';
import { errorPlugin } from '../../src/plugins/error.plugin.js';
import { serverKitContextPlugin } from '../../src/plugins/serverkit.context.plugin.js';
import { createTestApp, type TestAppOptions } from '../test.app.js';

const plugins: TestAppOptions['plugins'] = container => [errorPlugin(container), serverKitContextPlugin(container), zodPlugin()];

const User = z.object({ id: z.number(), email: z.string() });

describe('zodSerializerCompiler', () => {
  it('serializes a response through the schema for its status code', async () => {
    const { app: instance } = await createTestApp({ plugins });
    const app = instance.withTypeProvider<ZodTypeProvider>();
    app.get('/users/1', { schema: { response: { 200: User } } }, async () => ({ id: 1, email: 'a@b.com' }));

    const response = await app.inject({ method: 'GET', url: '/users/1' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toEqual({ id: 1, email: 'a@b.com' });
  });

  it('drops properties the schema does not describe', async () => {
    const { app: instance } = await createTestApp({ plugins });
    const app = instance.withTypeProvider<ZodTypeProvider>();
    app.get('/leaky', { schema: { response: { 200: User } } }, async () => ({ id: 1, email: 'a@b.com', passwordHash: 'secret' }) as never);

    const response = await app.inject({ method: 'GET', url: '/leaky' });

    expect(response.json()).toEqual({ id: 1, email: 'a@b.com' });
  });

  it('serializes each status code with its own schema', async () => {
    const { app: instance } = await createTestApp({ plugins });
    const app = instance.withTypeProvider<ZodTypeProvider>();
    app.get(
      '/maybe',
      { schema: { response: { 200: User, 202: z.object({ queued: z.boolean() }) } } },
      async (_request, reply) => reply.status(202).send({ queued: true }),
    );

    const response = await app.inject({ method: 'GET', url: '/maybe' });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ queued: true });
  });

  it('fails at boot for a schema JSON Schema cannot express, not per request', async () => {
    const { app: instance } = await createTestApp({ plugins });
    const app = instance.withTypeProvider<ZodTypeProvider>();

    // z.date() has no JSON Schema equivalent: compileSerializer throws rather than serializing it
    // wrongly on every request. Response schemas are compiled while the server comes up, so the
    // failure surfaces from ready() rather than from the route call or a request.
    app.get('/dated', { schema: { response: { 200: z.object({ at: z.date() }) } } }, async () => ({ at: new Date() }));

    await expect(app.ready()).rejects.toThrow();
  });
});
