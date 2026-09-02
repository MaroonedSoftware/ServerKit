import { httpError, IsHttpError } from '@maroonedsoftware/errors';
import { ServerKitBodyParser, ServerKitBodySource } from './serverkit.bodyparser.js';
import { ServerKitParserResult } from './parsers/serverkit.parser.js';

/**
 * The request facts a per-route body gate needs, expressed structurally so each HTTP adapter can
 * build one from its own request object (Koa's `ctx.request`, or Fastify's headers plus `type-is`).
 */
export interface BodyGateRequest {
  /** Declared body length in bytes; `0` when there is no body. */
  length: number;
  /** The request's media type without parameters (e.g. `application/json`), or `''` when absent. */
  type: string;
  /** Content-type matcher with `type-is` semantics: the matched type, or a falsy value when none match. */
  is: (types: string[]) => string | false | null;
}

/**
 * Enforces a route's body expectation before any bytes are parsed. This is the status contract
 * every adapter's `bodyParserMiddleware` shares:
 *
 * - `contentTypes` empty: a body is not allowed. Throws **400** when one is present.
 * - `contentTypes` non-empty: a body is required. Throws **411** when absent and **415** when its
 *   `Content-Type` is not in the allow-list.
 *
 * @param request - The request facts; see {@link BodyGateRequest}.
 * @param contentTypes - Allowed MIME types for this route; empty to forbid a body.
 * @returns `true` when the caller should now parse the body, `false` when there is nothing to parse.
 * @throws {HttpError} 400, 411, or 415 as described above.
 */
export const assertBodyExpectation = (request: BodyGateRequest, contentTypes: string[]): boolean => {
  if (contentTypes.length === 0) {
    if (request.length > 0) {
      throw httpError(400).withDetails({ body: 'Unexpected body' });
    }
    return false;
  }

  if (request.length > 0) {
    if (!request.is(contentTypes)) {
      throw httpError(415).withDetails({
        'content-type': `must be ${contentTypes.length > 1 ? 'one of ' : ''}${contentTypes.join(', ')}`,
        value: request.type,
      });
    }
    return true;
  }

  throw httpError(411);
};

/**
 * Parses a route body through the registered {@link ServerKitBodyParser}, normalising failures:
 * an `HttpError` thrown by a parser (a 400 for malformed JSON, a 413 for an oversized body, the
 * dispatcher's own 415) is rethrown as-is, and anything else becomes a **422** with the original
 * error as its cause.
 *
 * @param parser - The body parser resolved from the request scope.
 * @param source - The raw request, or an object carrying it as `req`.
 * @returns The parsed value and raw bytes.
 * @throws {HttpError} A parser's own HTTP error, or 422 `Invalid request body format`.
 */
export const parseRouteBody = async (parser: ServerKitBodyParser, source: ServerKitBodySource): Promise<ServerKitParserResult> => {
  try {
    return await parser.parse(source);
  } catch (error) {
    if (IsHttpError(error)) {
      throw error;
    }
    throw httpError(422)
      .withCause(error as Error)
      .withDetails({ body: 'Invalid request body format' });
  }
};
