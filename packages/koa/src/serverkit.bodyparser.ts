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
    const parser = this.parsers.get(mimeType);
    if (!parser) {
      throw httpError(415).withDetails({ body: 'Unsupported media type' });
    }
    return parser.parse(ctx.req);
  }
}
