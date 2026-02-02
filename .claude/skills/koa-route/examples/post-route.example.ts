import { ServerKitRouter, bodyParserMiddleware } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';

const router = new ServerKitRouter();

router.post('/api/users', bodyParserMiddleware(['application/json']), async ctx => {
  ctx.logger.info('Handling POST /api/users', { requestId: ctx.requestId });

  // Validate request body
  const body = ctx.body as { name?: string; email?: string };

  if (!body.name || !body.email) {
    throw httpError(400).withDetails({
      name: !body.name ? 'Name is required' : undefined,
      email: !body.email ? 'Email is required' : undefined
    });
  }

  // Use DI container to get service
  // const userService = ctx.container.get(UserService);
  // const user = await userService.create(body);

  // TODO: Implement user creation
  const newUser = {
    id: 'user-123',
    name: body.name,
    email: body.email,
    createdAt: new Date().toISOString()
  };

  ctx.status = 201;
  ctx.body = newUser;
});

export default router;
