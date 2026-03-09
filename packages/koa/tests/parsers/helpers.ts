import { Readable } from 'stream';
import type { IncomingMessage } from 'http';

/**
 * Creates a minimal IncomingMessage-shaped Readable stream for use in parser tests.
 */
export function makeReq(
  body: string | Buffer,
  headers: Record<string, string> = {},
): IncomingMessage {
  const stream = Readable.from([body]);
  return Object.assign(stream, { headers }) as unknown as IncomingMessage;
}
