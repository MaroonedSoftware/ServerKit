import { describe, it, expect, beforeEach } from 'vitest';
import type { IncomingMessage } from 'http';

import { MultipartParser } from '../../src/parsers/multipart.parser.js';
import { MultipartBody } from '@maroonedsoftware/multipart';

describe('MultipartParser', () => {
  let parser: MultipartParser;
  let mockReq: IncomingMessage;

  beforeEach(() => {
    parser = new MultipartParser();
    mockReq = { headers: {} } as unknown as IncomingMessage;
  });

  it('wraps the request in a MultipartBody', async () => {
    const result = await parser.parse(mockReq);

    expect(result.parsed).toBeInstanceOf(MultipartBody);
  });

  it('constructs the MultipartBody with the request', async () => {
    const result = await parser.parse(mockReq);

    // `req` is stored as a private field; the parse is lazy, so construction does not consume the stream.
    expect((result.parsed as unknown as { req: IncomingMessage }).req).toBe(mockReq);
  });

  it('returns raw as an empty Buffer', async () => {
    const result = await parser.parse(mockReq);

    expect(result.raw).toBeInstanceOf(Buffer);
  });
});
