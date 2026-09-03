import type { FastifyRequest } from 'fastify';
import typeis from 'type-is';
import { httpError, ServerkitError } from '@maroonedsoftware/errors';
import { assertBodyExpectation, parseRouteBody, ServerKitBodyParser } from '@maroonedsoftware/servercore';
import { serverKitPlugin, type ServerKitPlugin } from '../serverkit.plugin.js';
import { requestBodyLength, requestMediaType } from '../request/request.accessors.js';

/** The methods Fastify never parses a body for; a body sent to one is rejected, never parsed. */
const BODYLESS_METHODS = new Set(['GET', 'HEAD', 'TRACE']);

/**
 * Parses request bodies through ServerKit's DI-registered parsers, gated by each route's
 * `config.body` allow-list, and puts the result on Fastify's own `request.body` (with the raw
 * bytes on `request.rawBody`).
 *
 * Fastify's built-in parsers are removed and replaced by a single catch-all, so the parser that
 * runs is always the one `ServerKitBodyParser` selects for the request's `Content-Type` — the
 * same dispatcher, options, and limits every other ServerKit adapter uses.
 *
 * A route declares what it accepts in its route `config`:
 *
 * ```typescript
 * app.post('/invoices', { config: { body: ['application/json'] } }, async request => request.body);
 * ```
 *
 * A route with no `body` entry accepts no body at all, so an unexpected one is a 400. The status
 * contract is `assertBodyExpectation` from `@maroonedsoftware/servercore`, shared with the Koa
 * adapter: 400 for an unexpected body, 411 for a missing required one, 415 for a disallowed
 * `Content-Type`, and 422 for a body the parser could not read.
 *
 * `GET`, `HEAD`, and `TRACE` are exempt from the 411: Fastify never parses a body for them, so a
 * body allow-list on such a route cannot be satisfied. A body sent to one is still a 400.
 *
 * Register it after {@link serverKitContextPlugin}, whose `request.container` it resolves the
 * parser from.
 *
 * @returns A {@link ServerKitPlugin} installing the gate and the parser.
 * @throws {HttpError} 400, 411, 415, 422, or 413 per the contract above.
 */
export const bodyParserPlugin = (): ServerKitPlugin => {
  return serverKitPlugin('serverkit.body.parser', async app => {
    // Fastify's own JSON and text parsers would consume the stream before ServerKit's dispatcher
    // saw it, and an unmatched type would 415 with Fastify's body rather than ServerKit's.
    app.removeAllContentTypeParsers();

    // Fastify only runs a content-type parser for methods that may carry a body, so the gate is a
    // preParsing hook: it runs for every method, which is what rejects a GET with a body.
    app.addHook('preParsing', async request => {
      // An unrouted request has no route config to gate against; let it fall through to the
      // not-found handler rather than answering 400 for a URL that does not exist.
      if (request.is404) return;

      const declared = request.routeOptions.config.body ?? [];

      // A route that validates a body but never accepts one would reject every request with an
      // opaque 400. Say what is actually wrong; this is a wiring mistake, not a client error.
      if (declared.length === 0 && request.routeOptions.schema?.body !== undefined) {
        throw new ServerkitError(
          `Route ${request.method} ${request.routeOptions.url ?? request.url} declares a body schema but no config.body content types`,
        );
      }

      // Fastify never parses a body on GET, HEAD, or TRACE, so "a body is required" cannot hold
      // there whatever the route declares. The gate still rejects a body that was sent anyway.
      const contentTypes = BODYLESS_METHODS.has(request.method) ? [] : declared;

      assertBodyExpectation(
        {
          length: requestBodyLength(request),
          type: requestMediaType(request),
          is: types => typeis(request.raw, types),
        },
        contentTypes,
      );
    });

    // The payload stream is ignored: ServerKitBodyParser dispatches on the request's headers and
    // reads `request.raw` itself, so a preParsing hook that replaces the payload is not honoured.
    app.addContentTypeParser('*', async (request: FastifyRequest) => {
      if (request.is404 || requestBodyLength(request) === 0) return undefined;

      // Fastify's own bodyLimit only applies to its `parseAs` parsers, and a stream parser owns
      // the stream, so this header check is all Fastify's limit can do here. The real ceiling is
      // the parser's own option (JsonParserOptions.limit and friends), enforced while reading.
      if (requestBodyLength(request) > request.routeOptions.bodyLimit) {
        throw httpError(413).withDetails({ body: 'Request body too large' });
      }

      const parser = request.container.get(ServerKitBodyParser);
      const result = await parseRouteBody(parser, request.raw);
      request.rawBody = result.raw;
      return result.parsed;
    });
  });
};
