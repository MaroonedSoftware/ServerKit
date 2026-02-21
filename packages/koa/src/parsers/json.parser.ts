import { parse, Reviver } from '@hapi/bourne';
import { IncomingMessage } from 'http';
import raw from 'raw-body';
import inflate from 'inflation';
import { httpError } from '@maroonedsoftware/errors';
import { ServerKitParser, ServerKitParserResult } from './serverkit.parser.js';
import { Injectable } from 'injectkit';

export type JsonParserOptions = raw.Options & {
  strict?: boolean;
  protoAction?: 'error' | 'remove' | 'ignore';
  reviver?: Reviver;
};

// Allowed whitespace is defined in RFC 7159
// http://www.rfc-editor.org/rfc/rfc7159.txt
const strictJSONReg = /^[\x20\x09\x0a\x0d]*(\[|\{)/;

@Injectable()
export class JsonParser extends ServerKitParser {
  constructor(private readonly options: JsonParserOptions = {}) {
    super();
  }

  async parse(req: IncomingMessage): Promise<ServerKitParserResult> {
    const len = req.headers['content-length'];
    const contentEncoding = req.headers['content-encoding'] || 'identity';
    const length: number | undefined = len && contentEncoding === 'identity' ? ~~len : undefined;
    const encoding = this.options?.encoding ?? 'utf8';
    const limit = this.options?.limit ?? '1mb';

    const strict = this.options?.strict ?? true;
    const protoAction = this.options?.protoAction ?? 'error';

    const str = await raw(inflate(req), { encoding, limit, length });

    const doParse = (str: string) => {
      try {
        if (this.options?.reviver) {
          return parse(str, this.options.reviver, { protoAction });
        }
        return parse(str, { protoAction });
      } catch (err) {
        throw httpError(400).withCause(err as Error);
      }
    };

    if (!strict) {
      return str ? { parsed: doParse(str), raw: str } : { parsed: undefined, raw: str };
    } else if (!str) {
      return { parsed: undefined, raw: str };
    } else if (!strictJSONReg.test(str)) {
      throw httpError(400).withDetails({ body: 'Invalid JSON, only supports object and array' });
    }
    return { parsed: doParse(str), raw: str };
  }
}
