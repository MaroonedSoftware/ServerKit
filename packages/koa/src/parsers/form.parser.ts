import { httpError } from '@maroonedsoftware/errors';
import { Injectable } from 'injectkit';
import { ServerKitParser, ServerKitParserResult } from './serverkit.parser.js';
import { IncomingMessage } from 'http';
import { parse, IParseOptions } from 'qs';
import raw from 'raw-body';
import inflate from 'inflation';

/**
 * Configuration options for {@link FormParser}.
 *
 * Combines `raw-body` read options with `qs` parse options.
 * All fields are optional; defaults are applied by the parser itself.
 *
 * @property encoding        - Body text encoding (default: `'utf8'`).
 * @property limit           - Maximum body size (default: `'56kb'`).
 * @property length          - Expected byte length from `Content-Length` (auto-set by the parser).
 * @property allowDots       - When `true`, `qs` interprets dot notation (`user.name`) as nested objects.
 * @property depth           - Maximum nesting depth for parsed objects (default: `qs` default of `5`).
 * @property parameterLimit  - Maximum number of parameters to parse (default: `qs` default of `1000`).
 */
@Injectable()
export class FormParserOptions implements raw.Options, IParseOptions {
  encoding?: string;
  limit?: string;
  length?: number;
  allowDots?: boolean;
  depth?: number;
  parameterLimit?: number;
}

/**
 * Parses a URL-encoded (`application/x-www-form-urlencoded`) request body using `qs`.
 *
 * Supports nested objects via bracket notation (`user[name]=alice`) by default.
 * Dot notation (`user.name=alice`) requires `allowDots: true` in the options.
 * An empty body resolves to `{ parsed: {} }`.
 *
 * @throws HTTP 400 if `qs.parse` throws unexpectedly.
 *
 * @example
 * ```typescript
 * // Default options (injectable)
 * const parser = new FormParser(new FormParserOptions());
 *
 * // Enable dot notation
 * const parser = new FormParser({ allowDots: true });
 * ```
 */
@Injectable()
export class FormParser extends ServerKitParser {
  constructor(private readonly options: FormParserOptions) {
    super();
  }

  /**
   * Reads, decompresses, and URL-decodes the request body.
   *
   * @param req - Incoming HTTP request whose body will be consumed.
   * @returns `{ parsed: <object>, raw: <original url-encoded string> }`.
   * @throws HTTP 400 if parsing fails.
   */
  async parse(req: IncomingMessage): Promise<ServerKitParserResult> {
    const len = req.headers['content-length'];
    const contentEncoding = req.headers['content-encoding'] || 'identity';
    const length: number | undefined = len && contentEncoding === 'identity' ? ~~len : undefined;
    const encoding = this.options.encoding ?? 'utf8';
    const limit = this.options.limit ?? '56kb';

    const str = await raw(inflate(req), { encoding, limit, length });

    try {
      return { parsed: parse(str, this.options), raw: str };
    } catch (err) {
      throw httpError(400).withCause(err as Error);
    }
  }
}
