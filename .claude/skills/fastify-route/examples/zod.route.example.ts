import type { FastifyPluginAsync } from 'fastify';
import { requirePolicy } from '@maroonedsoftware/fastify';
import { type ZodTypeProvider } from '@maroonedsoftware/fastify/zod';
import { z } from 'zod';

const CreateUser = z.object({ email: z.email(), name: z.string().min(1) });
const User = z.object({ id: z.string(), email: z.string(), name: z.string() });

/**
 * The same route with Zod schemas, which needs `zodPlugin()` in the server's plugin stack.
 * Fastify validates the body before the handler runs and `request.body` is typed from the schema,
 * so there is no `parseAndValidate` call and no cast. `config.body` is still required: it is the
 * content-type allow-list, which the schema does not replace.
 */
export const usersRoutes: FastifyPluginAsync = async instance => {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/users',
    { config: { body: ['application/json'] }, schema: { body: CreateUser, response: { 201: User } }, preHandler: [requirePolicy()] },
    async (request, reply) => {
      request.logger.info('Handling POST /users', { requestId: request.requestId, email: request.body.email });

      // const user = await request.container.get(UserService).create(request.body);
      // return reply.status(201).send(user);

      return reply.status(201).send({ id: 'not-implemented', email: request.body.email, name: request.body.name });
    },
  );
};
