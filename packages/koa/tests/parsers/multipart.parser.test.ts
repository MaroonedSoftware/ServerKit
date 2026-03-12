import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage } from 'http';

vi.mock('@maroonedsoftware/multipart', () => ({
  // Must use a regular function so it can be called with `new`
  MultipartBody: vi.fn(function (this: { _req: IncomingMessage }, req: IncomingMessage) {
    this._req = req;
  }),
}));

import { MultipartParser } from '../../src/parsers/multipart.parser.js';
import { MultipartBody } from '@maroonedsoftware/multipart';

describe('MultipartParser', () => {
  let parser: MultipartParser;
  let mockReq: IncomingMessage;

  beforeEach(() => {
    vi.clearAllMocks();
    parser = new MultipartParser();
    mockReq = { headers: {} } as unknown as IncomingMessage;
  });

  it('constructs a MultipartBody with the request', async () => {
    await parser.parse(mockReq);

    expect(MultipartBody).toHaveBeenCalledWith(mockReq);
  });

  it('returns the MultipartBody instance as parsed', async () => {
    const result = await parser.parse(mockReq);

    expect(result.parsed).toEqual({ _req: mockReq });
  });

  it('returns raw as an empty Buffer', async () => {
    const result = await parser.parse(mockReq);

    expect(result.raw).toBeInstanceOf(Buffer);
  });
});
