import { parse, Reviver } from '@hapi/bourne';
import { IncomingMessage } from 'http';
import raw from 'raw-body';
import inflate from 'inflation';
import { httpError } from '@maroonedsoftware/errors';
import { ServerKitParser, ServerKitParserResult } from './serverkit.parser.js';
import { Injectable } from 'injectkit';

/**
 * Configuration options for {@link JsonParser}.
 *
 * All fields are optional; defaults are applied by the parser itself.
 *
 * @property strict      - When `true` (default), only JSON objects `{}` and arrays `[]` are accepted.
 *                         When `false`, any valid JSON value (string, number, etc.) is allowed.
 * @property protoAction - How `@hapi/bourne` handles `__proto__` keys. Defaults to `'error'`.
 * @property reviver     - Optional JSON reviver function passed to `@hapi/bourne`.
 * @property encoding    - Body text encoding (default: `'utf8'`).
 * @property limit       - Maximum body size (default: `'1mb'`).
 * @property length      - Expected byte length from `Content-Length` (auto-set by the parser).
 */
@Injectable()
export class JsonParserOptions implements raw.Options {
  strict?: boolean;
  protoAction?: 'error' | 'remove' | 'ignore';
  reviver?: Reviver;
  encoding?: string;
  limit?: string;
  length?: number;
}

// Allowed whitespace is defined in RFC 7159
// http://www.rfc-editor.org/rfc/rfc7159.txt
/* eslint-disable-next-line no-control-regex */
const strictJSONReg = /^[\x20\x09\x0a\x0d]*(\[|\{)/;

/**
 * Parses a JSON request body using `@hapi/bourne` for prototype-pollution protection.
 *
 * In strict mode (default), only top-level objects `{}` and arrays `[]` are accepted;
 * any other value throws HTTP 400. In non-strict mode, any valid JSON value is accepted.
 * An empty body always resolves to `{ parsed: undefined }`.
 *
 * @throws HTTP 400 if the body is not valid JSON or fails the strict-mode check.
 *
 * @example
 * ```typescript
 * // Default strict mode (injectable)
 * const parser = new JsonParser(new JsonParserOptions());
 *
 * // Custom options
 * const lenient = new JsonParser({ strict: false, protoAction: 'remove' });
 * ```
 */
@Injectable()
export class JsonParser extends ServerKitParser {
  constructor(private readonly options: JsonParserOptions) {
    super();
  }

  /**
   * Reads, decompresses, and JSON-parses the request body.
   *
   * @param req - Incoming HTTP request whose body will be consumed.
   * @returns `{ parsed: <object|array|undefined>, raw: <original string> }`.
   * @throws HTTP 400 on malformed JSON or strict-mode violation.
   */
  async parse(req: IncomingMessage): Promise<ServerKitParserResult> {
    const len = req.headers['content-length'];
    const contentEncoding = req.headers['content-encoding'] || 'identity';
    const length: number | undefined = len && contentEncoding === 'identity' ? ~~len : undefined;
    const encoding = this.options.encoding ?? 'utf8';
    const limit = this.options.limit ?? '1mb';

    const strict = this.options.strict ?? true;
    const protoAction = this.options.protoAction ?? 'error';

    const str = await raw(inflate(req), { encoding, limit, length });

    const doParse = (str: string) => {
      try {
        if (this.options.reviver) {
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
