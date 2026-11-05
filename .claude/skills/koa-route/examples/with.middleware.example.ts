import { ServerKitRouter, bodyParserMiddleware, requirePolicy, requireSignature } from '@maroonedsoftware/koa';
import { httpError } from '@maroonedsoftware/errors';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { DateTime } from 'luxon';
import { z } from 'zod';

const UpdateUser = z.object({ email: z.email().optional(), name: z.string().min(1).optional() });

const router = ServerKitRouter();

// Route middleware runs left to right. A route may accept several content types.
router.put(
  '/api/users/:id',
  requirePolicy({ policy: 'auth.session.assurance.level' }),
  bodyParserMiddleware(['application/json', 'application/x-www-form-urlencoded']),
  async ctx => {
    const { id } = ctx.params;
    const body = await parseAndValidate(ctx.parsedBody, UpdateUser);

    if (!body.email && !body.name) {
      throw httpError(400).withDetails({ body: 'At least one field must be provided' });
    }

    ctx.logger.info('Handling PUT /api/users/:id', { requestId: ctx.requestId, id });

    // const user = await ctx.container.get(UserService).update(id, body);

    ctx.body = { id, ...body, updatedAt: DateTime.utc().toISO() };
  },
);

router.delete('/api/users/:id', requirePolicy(), async ctx => {
  ctx.logger.info('Handling DELETE /api/users/:id', { requestId: ctx.requestId, id: ctx.params.id });

  // await ctx.container.get(UserService).delete(ctx.params.id);

  ctx.status = 204;
});

// requireSignature checks ctx.rawBody, so bodyParserMiddleware has to run before it. The argument is
// the AppConfig key holding the signature options, and the policy must be in the PolicyRegistryMap.
router.post('/webhooks/github', bodyParserMiddleware(['application/json']), requireSignature('webhook'), async ctx => {
  ctx.status = 204;
});

export default router;
