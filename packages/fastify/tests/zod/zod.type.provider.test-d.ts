import { describe, it, expectTypeOf } from 'vitest';
import { z } from 'zod';
import Fastify from 'fastify';
import type { ZodTypeProvider } from '../../src/zod/zod.type.provider.js';

describe('ZodTypeProvider', () => {
  it('infers request types from the route schema', () => {
    const app = Fastify().withTypeProvider<ZodTypeProvider>();

    app.post(
      '/users/:id',
      {
        schema: {
          body: z.object({ email: z.string(), age: z.number() }),
          params: z.object({ id: z.coerce.number() }),
          querystring: z.object({ verbose: z.stringbool() }),
        },
      },
      async request => {
        expectTypeOf(request.body).toEqualTypeOf<{ email: string; age: number }>();
        expectTypeOf(request.params).toEqualTypeOf<{ id: number }>();
        expectTypeOf(request.query).toEqualTypeOf<{ verbose: boolean }>();
        return 'ok';
      },
    );
  });

  it('infers a transformed body as the schema output type', () => {
    const app = Fastify().withTypeProvider<ZodTypeProvider>();

    app.post('/upper', { schema: { body: z.object({ name: z.string().transform(value => value.length) }) } }, async request => {
      expectTypeOf(request.body).toEqualTypeOf<{ name: number }>();
      return 'ok';
    });
  });

  it('leaves a route without a schema untyped rather than wrong', () => {
    const app = Fastify().withTypeProvider<ZodTypeProvider>();

    app.post('/free', async request => {
      expectTypeOf(request.body).toEqualTypeOf<unknown>();
      return 'ok';
    });
  });
});
