import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';

// ServerKitRouter is a factory, not a class. Calling it with `new` throws at runtime.
const router = ServerKitRouter();

// No bodyParserMiddleware: a GET takes no body, and ctx.parsedBody stays undefined.
router.get('/api/users/:id', requirePolicy(), async ctx => {
  const { id } = ctx.params;

  ctx.logger.info('Handling GET /api/users/:id', { requestId: ctx.requestId, id });

  // Resolve request-scoped services from ctx.container, never the root container.
  // const user = await ctx.container.get(UserService).findById(id);
  const user = id === 'example' ? { id, name: 'Example User', email: 'user@example.com' } : undefined;

  if (!user) {
    throw httpError(404).withDetails({ id: 'User not found' });
  }

  ctx.body = user;
});

// Mount it on the server: builder.setupRoutes([router]);
export default router;
