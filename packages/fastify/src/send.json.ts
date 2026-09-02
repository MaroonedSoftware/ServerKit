import type { FastifyReply } from 'fastify';

/**
 * Sends a pre-serialized JSON string as the response body.
 *
 * Fastify sends a string body as `text/plain` unless a content type was set explicitly — this
 * helper exists to make that footgun impossible. It pairs with `compileSerializer` from
 * `@maroonedsoftware/zod/serializer`, whose compiled output skips Fastify's own serialisation
 * pass entirely, but any pre-serialized JSON string works.
 *
 * @param reply - The reply to write to.
 * @param serialized - A complete JSON document as a string (e.g. from a compiled serializer).
 * @param status - Response status. Defaults to `200`.
 *
 * @example
 * ```typescript
 * const serializeUser = compileSerializer(User);
 *
 * router.get('/users/:id', async (request, reply) => {
 *   const user = await service.getById((request.params as { id: string }).id);
 *   sendJson(reply, serializeUser(user));
 * });
 * ```
 */
export const sendJson = (reply: FastifyReply, serialized: string, status = 200): void => {
  void reply.status(status).type('application/json').send(serialized);
};
