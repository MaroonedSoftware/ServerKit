import { Injectable } from 'injectkit';
import { ServerKitParser, ServerKitParserResult } from './parsers/serverkit.parser.js';
import { ServerKitContext } from './serverkit.context.js';
import { unique } from '@maroonedsoftware/utilities';
import { httpError } from '@maroonedsoftware/errors';

@Injectable()
export class ServerKitParserMappings extends Map<string, ServerKitParser> {}

@Injectable()
export class ServerKitBodyParser {
  private readonly mimeTypes: string[];
  constructor(private readonly parsers: ServerKitParserMappings) {
    this.mimeTypes = unique(Array.from(this.parsers.keys()));
  }

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
