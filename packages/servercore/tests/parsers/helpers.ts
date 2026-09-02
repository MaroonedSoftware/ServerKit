import { Readable } from 'stream';
import type { IncomingMessage } from 'http';

/**
 * Creates a minimal IncomingMessage-shaped Readable stream for use in parser tests.
 */
export function makeReq(body: string | Buffer, headers: Record<string, string> = {}): IncomingMessage {
  // A real IncomingMessage emits Buffer chunks; raw-body v4 rejects string chunks outright.
  const stream = Readable.from([typeof body === 'string' ? Buffer.from(body) : body]);
  return Object.assign(stream, { headers }) as unknown as IncomingMessage;
}
