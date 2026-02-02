import { ServerKitRouter } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';

const router = new ServerKitRouter();

router.get('/api/users/:id', async ctx => {
  ctx.logger.info('Handling GET /api/users/:id', {
    requestId: ctx.requestId,
    userId: ctx.params.id
  });

  // Validate input
  const userId = ctx.params.id;
  if (!userId) {
    throw httpError(400).withDetails({ id: 'User ID is required' });
  }

  // Use DI container to get service
  // const userService = ctx.container.get(UserService);
  // const user = await userService.findById(userId);

  // TODO: Implement user lookup
  ctx.body = {
    id: userId,
    name: 'Example User',
    email: 'user@example.com'
  };
});

export default router;
