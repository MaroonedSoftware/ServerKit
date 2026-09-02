import typeis from 'type-is';
import { assertBodyExpectation, parseRouteBody, ServerKitBodyParser } from '@maroonedsoftware/servercore';
import { ServerKitRouterMiddleware } from '../../serverkit.middleware.js';
import { requestBodyLength, requestMediaType } from '../../serverkit.request.js';

/**
 * Parses the request body based on `Content-Type` and assigns it to `request.parsedBody`
 * (the raw bytes are also exposed on `request.rawBody`). Rejects requests with unexpected
 * or unsupported content types.
 *
 * ServerKit parses lazily, per route: the server builder removes Fastify's built-in parsers and
 * installs a no-op catch-all, so `request.raw` is still unread when this guard runs as a
 * `preHandler`. Fastify's own `request.body` therefore stays `undefined`; read
 * `request.parsedBody` instead. The status contract is `assertBodyExpectation` /
 * `parseRouteBody` from `@maroonedsoftware/servercore`, shared with every other adapter.
 *
 * Supported types: JSON, URL-encoded form, text, multipart, PDF (raw buffer).
 * Requires a body when `contentTypes` is non-empty; otherwise rejects bodies.
 *
 * @param contentTypes - Allowed MIME types (e.g. `['application/json', 'application/x-www-form-urlencoded']`).
 *   Use an empty array to disallow any request body.
 * @returns {@link ServerKitRouterMiddleware} that parses the body and sets `request.parsedBody`.
 * @throws HTTP 400 if body is present when no content types are allowed.
 * @throws HTTP 411 if body is required but missing.
 * @throws HTTP 415 if `Content-Type` is not in `contentTypes`.
 * @throws HTTP 422 if body is invalid or media type is unsupported.
 */
export const bodyParserMiddleware = (contentTypes: string[]): ServerKitRouterMiddleware => {
  return async request => {
    const shouldParse = assertBodyExpectation(
      { length: requestBodyLength(request), type: requestMediaType(request), is: types => typeis(request.raw, types) },
      contentTypes,
    );
    if (shouldParse) {
      const parser = request.container.get(ServerKitBodyParser);
      const result = await parseRouteBody(parser, request.raw);
      request.parsedBody = result.parsed;
      request.rawBody = result.raw;
    }
  };
};
