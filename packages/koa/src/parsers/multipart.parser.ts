import { Injectable } from 'injectkit';
import { ServerKitParser, ServerKitParserResult } from './serverkit.parser.js';
import { IncomingMessage } from 'http';
import { MultipartBody } from '@maroonedsoftware/multipart';

/**
 * Wraps the request stream in a {@link MultipartBody} for lazy multipart/form-data parsing.
 *
 * The body is **not** eagerly consumed; fields and files are read on-demand through the
 * `MultipartBody` API. `raw` is always `undefined` because the stream cannot be replayed
 * once consumed.
 */
@Injectable()
export class MultipartParser extends ServerKitParser {
  /**
   * Creates a {@link MultipartBody} around the request stream.
   *
   * @param req - Incoming HTTP request containing the multipart body.
   * @returns `{ parsed: MultipartBody, raw: undefined }`.
   */
  async parse(req: IncomingMessage): Promise<ServerKitParserResult> {
    return { parsed: new MultipartBody(req), raw: undefined };
  }
}
