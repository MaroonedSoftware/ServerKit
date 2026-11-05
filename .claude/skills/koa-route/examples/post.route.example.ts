import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { DateTime } from 'luxon';
import { z } from 'zod';

const CreateUser = z.object({ email: z.email(), name: z.string().min(1) });

const router = ServerKitRouter();

// requirePolicy runs first, so an unauthenticated caller is rejected before the body is read.
router.post('/api/users', requirePolicy(), bodyParserMiddleware(['application/json']), async ctx => {
  // The parsed payload is on ctx.parsedBody, typed unknown. ctx.body is Koa's response body.
  // parseAndValidate throws a 400 HttpError whose details name the failing fields.
  const body = await parseAndValidate(ctx.parsedBody, CreateUser);

  ctx.logger.info('Handling POST /api/users', { requestId: ctx.requestId, email: body.email });

  // const user = await ctx.container.get(UserService).create(body);

  ctx.status = 201;
  ctx.body = { id: 'not.implemented', ...body, createdAt: DateTime.utc().toISO() };
});

export default router;
