import { Injectable } from 'injectkit';
import { ServerKitParser, ServerKitParserResult } from './parsers/serverkit.parser.js';
import { ServerKitContext } from './serverkit.context.js';
import { unique } from '@maroonedsoftware/utilities';
import { httpError } from '@maroonedsoftware/errors';

/**
 * DI-injectable map of MIME subtypes to {@link ServerKitParser} instances.
 *
 * Register parser instances against their MIME subtypes, then bind this map
 * in the InjectKit container so {@link ServerKitBodyParser} can resolve them.
 *
 * @example
 * ```typescript
 * registry
 *   .register(ServerKitParserMappings)
 *   .useMap()
 *   .add('json', JsonParser)
 *   .add('urlencoded', FormParser);
 * ```
 */
@Injectable()
export class ServerKitParserMappings extends Map<string, ServerKitParser> {}

/**
 * Tests a concrete media type (e.g. `application/vnd.api+json`) against a registered
 * wildcard mapping key (e.g. `application/*+json` or the `+json` shorthand) using the
 * same suffix/wildcard semantics as `type-is`.
 *
 * `ctx.request.is()` returns the concrete matched type — not the pattern key — when a
 * request matches a wildcard registration, so a direct `Map.get(matched)` misses. This
 * helper lets the concrete type resolve back to the wildcard-registered parser instead
 * of falling through to a 415.
 *
 * @param pattern - The registered mapping key (may contain `*` or start with `+`).
 * @param type - The concrete media type resolved from the request's `Content-Type`.
 * @returns `true` when `type` matches `pattern`.
 */
const wildcardTypeMatches = (pattern: string, type: string): boolean => {
  // `+json` shorthand normalizes to `*/*+json`.
  const expected = pattern.startsWith('+') ? `*/*${pattern}` : pattern;
  const expectedParts = expected.split('/');
  const actualParts = type.split('/');
  if (expectedParts.length !== 2 || actualParts.length !== 2) return false;
  const [expectedType, expectedSub] = expectedParts as [string, string];
  const [actualType, actualSub] = actualParts as [string, string];

  if (expectedType !== '*' && expectedType !== actualType) return false;
  if (expectedSub.startsWith('*+')) {
    // e.g. `*+json` matches any subtype ending in `+json`.
    return actualSub.endsWith(expectedSub.slice(1));
  }
  if (expectedSub !== '*' && expectedSub !== actualSub) return false;
  return true;
};

/**
 * Selects and invokes the appropriate {@link ServerKitParser} for the incoming request
 * based on its `Content-Type` header.
 *
 * The set of supported MIME types is derived from the keys of the injected
 * {@link ServerKitParserMappings}. Duplicate keys are deduplicated automatically.
 *
 * @throws HTTP 415 if the request's `Content-Type` does not match any registered parser.
 *
 * @see {@link defaultParserMappings} – convenience map for the standard parsers
 * @see {@link bodyParserMiddleware} – the middleware that invokes this class
 */
@Injectable()
export class ServerKitBodyParser {
  private readonly mimeTypes: string[];
  constructor(private readonly parsers: ServerKitParserMappings) {
    this.mimeTypes = unique(Array.from(this.parsers.keys()));
  }

  /**
   * Matches the request's `Content-Type` to a registered parser and delegates parsing.
   *
   * @param ctx - The current {@link ServerKitContext}; used to inspect `Content-Type` and access `ctx.req`.
   * @returns The {@link ServerKitParserResult} from the matched parser.
   * @throws HTTP 415 if no parser is registered for the request's content type.
   */
  async parse(ctx: ServerKitContext): Promise<ServerKitParserResult> {
    const mimeType = ctx.request.is(this.mimeTypes);
    if (!mimeType) {
      throw httpError(415).withDetails({ body: 'Unsupported media type' });
    }
    // Exact-match fast path; fall back to wildcard resolution so a concrete type
    // (e.g. `application/vnd.api+json`) matched via a wildcard registration
    // (e.g. `application/*+json`) still finds its parser instead of throwing 415.
    const parser = this.parsers.get(mimeType) ?? this.resolveWildcardParser(mimeType);
    if (!parser) {
      throw httpError(415).withDetails({ body: 'Unsupported media type' });
    }
    return parser.parse(ctx.req);
  }

  /**
   * Resolves a parser for a concrete media type by testing it against each registered
   * wildcard-shaped mapping key. Only keys containing `*` or starting with `+` are
   * considered, so a genuinely unregistered concrete type still falls through to 415.
   *
   * @param matched - The concrete media type resolved from the request's `Content-Type`.
   * @returns The matching {@link ServerKitParser}, or `undefined` when none applies.
   */
  private resolveWildcardParser(matched: string): ServerKitParser | undefined {
    for (const key of this.mimeTypes) {
      if ((key.includes('*') || key.startsWith('+')) && wildcardTypeMatches(key, matched)) {
        const parser = this.parsers.get(key);
        if (parser) return parser;
      }
    }
    return undefined;
  }
}
