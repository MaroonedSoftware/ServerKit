import type { FastifyPluginAsync } from 'fastify';
import { requirePolicy } from '@maroonedsoftware/fastify';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { z } from 'zod';

const CreateUser = z.object({ email: z.email(), name: z.string().min(1) });

/**
 * POST route example: the accepted content types go in `config.body`, and the parsed payload
 * arrives on `request.body`. Validate it before use; `request.body` is `unknown` without a schema.
 */
export const usersRoutes: FastifyPluginAsync = async app => {
  app.post('/users', { config: { body: ['application/json'] }, preHandler: [requirePolicy()] }, async (request, reply) => {
    const body = await parseAndValidate(request.body, CreateUser);

    request.logger.info('Handling POST /users', { requestId: request.requestId, email: body.email });

    // const user = await request.container.get(UserService).create(body);
    // return reply.status(201).send(user);

    return reply.status(201).send({ message: 'Not implemented' });
  });
};
