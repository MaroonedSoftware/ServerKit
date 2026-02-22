import { Injectable } from 'injectkit';
import { ServerKitParser, ServerKitParserResult } from './serverkit.parser.js';
import { IncomingMessage } from 'http';
import raw from 'raw-body';
import inflate from 'inflation';

export type TextParserOptions = raw.Options;

@Injectable()
export class TextParser extends ServerKitParser {
  constructor(private readonly options: TextParserOptions = {}) {
    super();
  }

  async parse(req: IncomingMessage): Promise<ServerKitParserResult> {
    const len = req.headers['content-length'];
    const contentEncoding = req.headers['content-encoding'] || 'identity';
    const length: number | undefined = len && contentEncoding === 'identity' ? ~~len : undefined;
    const encoding = this.options.encoding ?? 'utf8';
    const limit = this.options.limit ?? '1mb';

    const str = await raw(inflate(req), { encoding, limit, length });

    return { parsed: str, raw: str };
  }
}
