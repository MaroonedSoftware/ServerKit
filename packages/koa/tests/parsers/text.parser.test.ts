import { describe, it, expect } from 'vitest';
import { TextParser } from '../../src/parsers/text.parser.js';
import { makeReq } from './helpers.js';

describe('TextParser', () => {
  const parser = new TextParser();

  it('returns the raw text string as both parsed and raw', async () => {
    const body = 'hello world';
    const result = await parser.parse(makeReq(body));

    expect(result.parsed).toBe(body);
    expect(result.raw).toBe(body);
  });

  it('handles an empty body', async () => {
    const result = await parser.parse(makeReq(''));

    expect(result.parsed).toBe('');
    expect(result.raw).toBe('');
  });

  it('preserves multiline text', async () => {
    const body = 'line one\nline two\nline three';
    const result = await parser.parse(makeReq(body));

    expect(result.parsed).toBe(body);
  });

  it('preserves special characters', async () => {
    const body = 'text with "quotes" & <special> chars';
    const result = await parser.parse(makeReq(body));

    expect(result.parsed).toBe(body);
  });

  it('reads body with content-length and identity encoding', async () => {
    const body = 'exact length';
    const req = makeReq(body, {
      'content-length': String(Buffer.byteLength(body)),
      'content-encoding': 'identity',
    });

    const result = await parser.parse(req);

    expect(result.parsed).toBe(body);
  });
});
