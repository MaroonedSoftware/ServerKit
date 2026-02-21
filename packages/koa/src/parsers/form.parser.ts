import { httpError } from '@maroonedsoftware/errors';
import { Injectable } from 'injectkit';
import { ServerKitParser, ServerKitParserResult } from './serverkit.parser.js';
import { IncomingMessage } from 'http';
import { parse, IParseOptions } from 'qs';
import raw from 'raw-body';
import inflate from 'inflation';

export type FormParserOptions = raw.Options & IParseOptions;

@Injectable()
export class FormParser extends ServerKitParser {
  constructor(private readonly options: FormParserOptions) {
    super();
  }

  async parse(req: IncomingMessage): Promise<ServerKitParserResult> {
    const len = req.headers['content-length'];
    const contentEncoding = req.headers['content-encoding'] || 'identity';
    const length: number | undefined = len && contentEncoding === 'identity' ? ~~len : undefined;
    const encoding = this.options?.encoding ?? 'utf8';
    const limit = this.options?.limit ?? '56kb';

    const str = await raw(inflate(req), { encoding, limit, length });

    try {
      return { parsed: parse(str, this.options), raw: str };
    } catch (err) {
      throw httpError(400).withCause(err as Error);
    }
  }
}
