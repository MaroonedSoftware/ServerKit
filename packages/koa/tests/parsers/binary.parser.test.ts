import { describe, it, expect } from 'vitest';
import { BinaryParser, BinaryParserOptions } from '../../src/parsers/binary.parser.js';
import { makeReq } from './helpers.js';

describe('BinaryParser', () => {
  const parser = new BinaryParser();

  it('returns a Buffer as parsed', async () => {
    const content = Buffer.from('binary content');
    const result = await parser.parse(makeReq(content));

    expect(Buffer.isBuffer(result.parsed)).toBe(true);
    expect(result.parsed).toEqual(content);
  });

  it('returns raw as an empty Buffer', async () => {
    const result = await parser.parse(makeReq(Buffer.from('data')));

    expect(result.raw).toBeInstanceOf(Buffer);
  });

  it('handles an empty body', async () => {
    const result = await parser.parse(makeReq(Buffer.alloc(0)));

    expect(Buffer.isBuffer(result.parsed)).toBe(true);
    expect((result.parsed as Buffer).length).toBe(0);
  });

  it('preserves binary data exactly', async () => {
    const content = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x7f]);
    const result = await parser.parse(makeReq(content));

    expect(result.parsed).toEqual(content);
  });

  it('rejects a body over the configured limit with 413', async () => {
    const limited = new BinaryParser(Object.assign(new BinaryParserOptions(), { limit: '8b' }));
    const content = Buffer.from('this body is definitely longer than eight bytes');

    await expect(limited.parse(makeReq(content))).rejects.toMatchObject({ status: 413 });
  });

  it('accepts a body within the configured limit', async () => {
    const limited = new BinaryParser(Object.assign(new BinaryParserOptions(), { limit: '1kb' }));
    const content = Buffer.from('small');

    const result = await limited.parse(makeReq(content));

    expect(result.parsed).toEqual(content);
  });
});
