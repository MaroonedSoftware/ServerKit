import { describe, it, expect } from 'vitest';
import { FormParser, FormParserOptions } from '../../src/parsers/form.parser.js';
import { makeReq } from './helpers.js';

describe('FormParser', () => {
  const parser = new FormParser(new FormParserOptions());

  it('parses a URL-encoded string', async () => {
    const body = 'field1=value1&field2=value2';
    const result = await parser.parse(makeReq(body));

    expect(result.parsed).toEqual({ field1: 'value1', field2: 'value2' });
    expect(result.raw).toBe(body);
  });

  it('returns the raw URL-encoded string', async () => {
    const body = 'a=1&b=2';
    const result = await parser.parse(makeReq(body));

    expect(result.raw).toBe(body);
  });

  it('parses nested objects via qs dot notation', async () => {
    const body = 'user%5Bname%5D=alice&user%5Bage%5D=30'; // user[name]=alice&user[age]=30
    const result = await parser.parse(makeReq(body));

    expect((result.parsed as any).user).toEqual({ name: 'alice', age: '30' });
  });

  it('returns an empty object for an empty body', async () => {
    const result = await parser.parse(makeReq(''));

    expect(result.parsed).toEqual({});
    expect(result.raw).toBe('');
  });

  it('respects content-length with identity encoding', async () => {
    const body = 'x=1';
    const req = makeReq(body, {
      'content-length': String(Buffer.byteLength(body)),
      'content-encoding': 'identity',
    });

    const result = await parser.parse(req);

    expect(result.parsed).toEqual({ x: '1' });
  });

  it('passes custom options to qs.parse', async () => {
    // allowDots allows user.name=alice to be parsed as { user: { name: 'alice' } }
    const parser = new FormParser({ allowDots: true });
    const body = 'user.name=alice';
    const result = await parser.parse(makeReq(body));

    expect((result.parsed as any).user).toEqual({ name: 'alice' });
  });
});
