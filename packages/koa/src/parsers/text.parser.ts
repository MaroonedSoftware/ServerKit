import { Injectable } from 'injectkit';
import { ServerKitParser, ServerKitParserResult } from './serverkit.parser.js';
import { IncomingMessage } from 'http';
import raw from 'raw-body';
import inflate from 'inflation';

/**
 * Configuration options for {@link TextParser}.
 *
 * All fields are optional; defaults are applied by the parser itself.
 *
 * @property encoding - Body text encoding (default: `'utf8'`).
 * @property limit    - Maximum body size (default: `'1mb'`).
 * @property length   - Expected byte length from `Content-Length` (auto-set by the parser).
 */
export class TextParserOptions implements raw.Options {
  encoding?: string;
  limit?: string;
  length?: number;
}

/**
 * Reads the request body as a plain string.
 *
 * No structural parsing is performed; the raw text is returned as both `parsed` and `raw`.
 * Suitable for `text/plain` and similar content types. Decompresses the stream via `inflation`
 * before buffering.
 *
 * @example
 * ```typescript
 * const parser = new TextParser(new TextParserOptions());
 * const { parsed } = await parser.parse(req); // parsed is a string
 * ```
 */
@Injectable()
export class TextParser extends ServerKitParser {
  constructor(private readonly options: TextParserOptions) {
    super();
  }

  /**
   * Reads and decompresses the request body into a string.
   *
   * @param req - Incoming HTTP request whose body will be consumed.
   * @returns `{ parsed: <string>, raw: <same string> }`.
   */
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
