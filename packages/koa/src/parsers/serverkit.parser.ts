import { BinaryLike } from 'node:crypto';
import { IncomingMessage } from 'http';
import { Injectable } from 'injectkit';

/**
 * The result returned by every {@link ServerKitParser}.
 *
 * @property parsed - The structured/deserialized value derived from the body (e.g. a plain object for JSON).
 * @property raw    - The unprocessed body bytes as read from the stream. Parsers that do not retain a raw
 *                    representation (e.g. binary, multipart) return an empty `Buffer`.
 */
export type ServerKitParserResult = {
  parsed: unknown;
  raw: BinaryLike;
};

/**
 * Abstract base class for all ServerKit body parsers.
 *
 * Implementations read from an {@link IncomingMessage} stream and return a
 * {@link ServerKitParserResult} containing both the parsed value and the raw body.
 * Each parser is registered in the DI container and selected by MIME type via
 * {@link ServerKitBodyParser}.
 *
 * @see {@link ServerKitBodyParser} – dispatcher that selects the right parser by MIME type
 * @see {@link defaultParserMappings} – built-in MIME-type-to-parser map
 */
@Injectable()
export abstract class ServerKitParser {
  /**
   * Reads and parses the body from the given request stream.
   *
   * @param req - The incoming HTTP request whose body should be consumed.
   * @returns A promise resolving to a {@link ServerKitParserResult}.
   */
  abstract parse(req: IncomingMessage): Promise<ServerKitParserResult>;
}
