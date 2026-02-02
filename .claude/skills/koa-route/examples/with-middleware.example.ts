import { ServerKitRouter, bodyParserMiddleware } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';

const router = new ServerKitRouter();

// Example with multiple middleware
router.put(
  '/api/users/:id',
  bodyParserMiddleware(['application/json', 'application/x-www-form-urlencoded']),
  async ctx => {
    ctx.logger.info('Handling PUT /api/users/:id', {
      requestId: ctx.requestId,
      userId: ctx.params.id
    });

    const userId = ctx.params.id;
    const body = ctx.body as { name?: string; email?: string };

    // Validate
    if (!userId) {
      throw httpError(400).withDetails({ id: 'User ID is required' });
    }

    if (!body.name && !body.email) {
      throw httpError(400).withDetails({
        message: 'At least one field must be provided'
      });
    }

    // Use DI container
    // const userService = ctx.container.get(UserService);
    // const user = await userService.update(userId, body);
    //
    // if (!user) {
    //   throw httpError(404).withDetails({ id: 'User not found' });
    // }

    // TODO: Implement user update
    ctx.body = {
      id: userId,
      ...body,
      updatedAt: new Date().toISOString()
    };
  }
);

router.delete('/api/users/:id', async ctx => {
  ctx.logger.info('Handling DELETE /api/users/:id', {
    requestId: ctx.requestId,
    userId: ctx.params.id
  });

  const userId = ctx.params.id;

  if (!userId) {
    throw httpError(400).withDetails({ id: 'User ID is required' });
  }

  // Use DI container
  // const userService = ctx.container.get(UserService);
  // await userService.delete(userId);

  // TODO: Implement user deletion
  ctx.status = 204;
});

export default router;
