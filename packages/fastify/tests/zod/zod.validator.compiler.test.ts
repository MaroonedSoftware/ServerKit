import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { parseAndValidate } from '@maroonedsoftware/zod';
import type { HttpError } from '@maroonedsoftware/errors';
import { zodPlugin } from '../../src/zod/zod.plugin.js';
import type { ZodTypeProvider } from '../../src/zod/zod.type.provider.js';
import { bodyParserPlugin } from '../../src/plugins/body.parser.plugin.js';
import { errorPlugin } from '../../src/plugins/error.plugin.js';
import { serverKitContextPlugin } from '../../src/plugins/serverkit.context.plugin.js';
import { createTestApp, type TestAppOptions } from '../test.app.js';

const plugins: TestAppOptions['plugins'] = container => [
  errorPlugin(container),
  serverKitContextPlugin(container),
  bodyParserPlugin(),
  zodPlugin(),
];

const CreateUser = z.object({ email: z.email(), age: z.number().min(0) });

describe('zodValidatorCompiler', () => {
  it('validates a body against the schema and hands the parsed output to the handler', async () => {
    const { app: instance } = await createTestApp({ plugins });
    const app = instance.withTypeProvider<ZodTypeProvider>();
    app.post('/users', { config: { body: ['application/json'] }, schema: { body: CreateUser } }, async request => ({
      email: request.body.email,
      age: request.body.age,
    }));

    const response = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'a@b.com', age: 30 }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ email: 'a@b.com', age: 30 });
  });

  it('applies a schema transform, so the handler sees the output type', async () => {
    const { app: instance } = await createTestApp({ plugins });
    const app = instance.withTypeProvider<ZodTypeProvider>();
    app.post(
      '/upper',
      { config: { body: ['application/json'] }, schema: { body: z.object({ name: z.string().transform(value => value.toUpperCase()) }) } },
      async request => ({ name: request.body.name }),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/upper',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'ada' }),
    });

    expect(response.json()).toEqual({ name: 'ADA' });
  });

  it('renders a failure exactly as parseAndValidate would', async () => {
    const { app: instance } = await createTestApp({ plugins });
    const app = instance.withTypeProvider<ZodTypeProvider>();
    app.post('/users', { config: { body: ['application/json'] }, schema: { body: CreateUser } }, async () => 'ok');
    const invalid = { email: 'nope', age: -1 };

    const response = await app.inject({
      method: 'POST',
      url: '/users',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(invalid),
    });
    const thrown = (await parseAndValidate(invalid, CreateUser).catch((error: unknown) => error)) as HttpError;

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ statusCode: 400, message: thrown.message, details: thrown.details });
  });

  it('validates params and query strings too', async () => {
    const { app: instance } = await createTestApp({ plugins });
    const app = instance.withTypeProvider<ZodTypeProvider>();
    app.get(
      '/users/:id',
      { schema: { params: z.object({ id: z.coerce.number() }), querystring: z.object({ verbose: z.stringbool() }) } },
      async request => ({ id: request.params.id, verbose: request.query.verbose }),
    );

    const ok = await app.inject({ method: 'GET', url: '/users/7?verbose=true' });
    expect(ok.json()).toEqual({ id: 7, verbose: true });

    const bad = await app.inject({ method: 'GET', url: '/users/seven?verbose=true' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ details: { id: expect.any(String) } });
  });

  it('logs and renders through the ServerKit error handler, tagged as a Fastify validation error', async () => {
    const { app: instance, logger } = await createTestApp({ plugins });
    const app = instance.withTypeProvider<ZodTypeProvider>();
    app.post('/users', { config: { body: ['application/json'] }, schema: { body: CreateUser } }, async () => 'ok');

    await app.inject({ method: 'POST', url: '/users', headers: { 'content-type': 'application/json' }, payload: '{}' });

    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ code: 'FST_ERR_VALIDATION', validationContext: 'body' }));
  });
});
