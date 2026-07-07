import { Injectable } from 'injectkit';
import { ServerKitParser, ServerKitParserResult } from './serverkit.parser.js';
import { IncomingMessage } from 'http';
import raw from 'raw-body';
import inflate from 'inflation';

/**
 * Configuration options for {@link BinaryParser}.
 *
 * All fields are optional; defaults are applied by the parser itself.
 *
 * @property limit  - Maximum body size (default: `'20mb'`, aligned with the multipart file-size default).
 * @property length - Expected byte length from `Content-Length` (auto-set by the parser).
 */
@Injectable()
export class BinaryParserOptions implements raw.Options {
  limit?: string;
  length?: number;
}

/**
 * Reads the request body as a raw `Buffer` without any text decoding or structural parsing.
 *
 * Useful for binary payloads (e.g. PDFs, images, protobuf) where the caller needs the
 * untransformed bytes. Decompresses the stream via `inflation` before buffering.
 *
 * The body is bounded by a configurable byte `limit` (default `'20mb'`) so an oversized
 * upload is rejected with HTTP 413 instead of being buffered without bound.
 *
 * `raw` is always an empty `Buffer` because the `Buffer` itself is both the parsed and raw form.
 */
// `deps: []` so the DI container constructs BinaryParser with no arguments (falling back to the
// default `BinaryParserOptions`), rather than treating `BinaryParserOptions` as a required
// registration. Callers can still `new BinaryParser(options)` directly for a custom limit.
@Injectable({ deps: [] })
export class BinaryParser extends ServerKitParser {
  constructor(private readonly options: BinaryParserOptions = new BinaryParserOptions()) {
    super();
  }

  /**
   * Buffers the (optionally compressed) request body into a `Buffer`, enforcing the configured limit.
   *
   * @param req - Incoming HTTP request to read.
   * @returns `{ parsed: Buffer, raw: Buffer(0) }`.
   * @throws HTTP 413 (via `raw-body`) if the body exceeds the configured `limit`.
   */
  async parse(req: IncomingMessage): Promise<ServerKitParserResult> {
    const len = req.headers['content-length'];
    const contentEncoding = req.headers['content-encoding'] || 'identity';
    const length: number | undefined = len && contentEncoding === 'identity' ? ~~len : undefined;
    const limit = this.options.limit ?? '20mb';

    return { parsed: await raw(inflate(req), { limit, length }), raw: Buffer.from('') };
  }
}
