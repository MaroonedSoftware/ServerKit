import { ServerKitRouterMiddleware } from '../../serverkit.middleware.js';
import { assertBodyExpectation, parseRouteBody, ServerKitBodyParser } from '@maroonedsoftware/servercore';

/**
 * Parses the request body based on `Content-Type` and assigns it to `ctx.parsedBody`
 * (the raw bytes are also exposed on `ctx.rawBody`). Rejects requests with unexpected
 * or unsupported content types.
 *
 * Note: the parsed value is stored on `ctx.parsedBody`, NOT `ctx.body`. In Koa `ctx.body`
 * is the *response* body; writing the request payload there would echo it back to the
 * client on any handler path that doesn't overwrite it.
 *
 * Supported types: JSON, URL-encoded form, text, multipart, PDF (raw buffer).
 * Requires a body when `contentTypes` is non-empty; otherwise rejects bodies. The status
 * contract is `assertBodyExpectation` / `parseRouteBody` from `@maroonedsoftware/servercore`,
 * shared with every other adapter.
 *
 * @param contentTypes - Allowed MIME types (e.g. `['application/json', 'application/x-www-form-urlencoded']`).
 *   Use an empty array to disallow any request body.
 * @returns {@link ServerKitRouterMiddleware} that parses the body and sets `ctx.parsedBody`.
 * @throws HTTP 400 if body is present when no content types are allowed.
 * @throws HTTP 411 if body is required but missing.
 * @throws HTTP 415 if `Content-Type` is not in `contentTypes`.
 * @throws HTTP 422 if body is invalid or media type is unsupported.
 */
export const bodyParserMiddleware = (contentTypes: string[]): ServerKitRouterMiddleware => {
  return async (ctx, next) => {
    const shouldParse = assertBodyExpectation(
      { length: ctx.request.length, type: ctx.request.type, is: types => ctx.request.is(types) },
      contentTypes,
    );
    if (shouldParse) {
      const parser = ctx.container.get(ServerKitBodyParser);
      const result = await parseRouteBody(parser, ctx);
      ctx.parsedBody = result.parsed;
      ctx.rawBody = result.raw;
    }
    await next();
  };
};
