import { Injectable } from 'injectkit';
import { ServerKitParser, ServerKitParserResult } from './serverkit.parser.js';
import { IncomingMessage } from 'http';
import raw from 'raw-body';
import inflate from 'inflation';

@Injectable()
export class BinaryParser extends ServerKitParser {
  async parse(req: IncomingMessage): Promise<ServerKitParserResult> {
    return { parsed: await raw(inflate(req)), raw: undefined };
  }
}
