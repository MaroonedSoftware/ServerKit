import type { FastifyPluginAsync } from 'fastify';
import { requirePolicy } from '@maroonedsoftware/fastify';
import { httpError } from '@maroonedsoftware/errors';

/**
 * GET route example: no body, so no `config.body`. A request that sends one is rejected with 400.
 */
export const usersRoutes: FastifyPluginAsync = async app => {
  app.get('/users/:id', { preHandler: [requirePolicy()] }, async request => {
    const { id } = request.params as { id: string };

    request.logger.info('Handling GET /users/:id', { requestId: request.requestId, id });

    if (!id) {
      throw httpError(400).withDetails({ id: 'User ID is required' });
    }

    // const user = await request.container.get(UserService).getById(id);
    // return user;

    return { message: 'Not implemented' };
  });
};
