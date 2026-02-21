import { Injectable } from 'injectkit';
import { ServerKitParser, ServerKitParserResult } from './serverkit.parser.js';
import { IncomingMessage } from 'http';
import { MultipartBody } from '@maroonedsoftware/multipart';

@Injectable()
export class MultipartParser extends ServerKitParser {
  async parse(req: IncomingMessage): Promise<ServerKitParserResult> {
    return { parsed: new MultipartBody(req), raw: undefined };
  }
}
