import { ServerKitContext } from './serverkit.context.js';

/**
 * Sends a pre-serialized JSON string as the response body.
 *
 * Koa infers `text/plain` for a string body unless a content type was set explicitly — this
 * helper exists to make that footgun impossible. It pairs with `compileSerializer` from
 * `@maroonedsoftware/zod/serializer`, whose compiled output skips Koa's own `JSON.stringify`
 * pass entirely, but any pre-serialized JSON string works.
 *
 * @param ctx - The request context to write to.
 * @param serialized - A complete JSON document as a string (e.g. from a compiled serializer).
 * @param status - Response status. Defaults to `200`.
 *
 * @example
 * ```typescript
 * const serializeUser = compileSerializer(User);
 *
 * router.get('/users/:id', async ctx => {
 *   const user = await service.getById(ctx.params.id);
 *   sendJson(ctx, serializeUser(user));
 * });
 * ```
 */
export const sendJson = (ctx: ServerKitContext, serialized: string, status = 200): void => {
  ctx.status = status;
  ctx.type = 'application/json';
  ctx.body = serialized;
};
