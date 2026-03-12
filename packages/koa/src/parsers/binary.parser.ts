import { Injectable } from 'injectkit';
import { ServerKitParser, ServerKitParserResult } from './serverkit.parser.js';
import { IncomingMessage } from 'http';
import raw from 'raw-body';
import inflate from 'inflation';

/**
 * Reads the request body as a raw `Buffer` without any text decoding or structural parsing.
 *
 * Useful for binary payloads (e.g. PDFs, images, protobuf) where the caller needs the
 * untransformed bytes. Decompresses the stream via `inflation` before buffering.
 *
 * `raw` is always `undefined` because the `Buffer` itself is both the parsed and raw form.
 */
@Injectable()
export class BinaryParser extends ServerKitParser {
  /**
   * Buffers the (optionally compressed) request body into a `Buffer`.
   *
   * @param req - Incoming HTTP request to read.
   * @returns `{ parsed: Buffer, raw: Buffer(0) }`.
   */
  async parse(req: IncomingMessage): Promise<ServerKitParserResult> {
    return { parsed: await raw(inflate(req)), raw: Buffer.from('') };
  }
}
