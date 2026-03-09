import { describe, it, expect } from 'vitest';
import { JsonParser, JsonParserOptions } from '../../src/parsers/json.parser.js';
import { makeReq } from './helpers.js';

describe('JsonParser', () => {
  describe('strict mode (default)', () => {
    const parser = new JsonParser(new JsonParserOptions());

    it('parses a valid JSON object', async () => {
      const body = '{"name":"test","value":123}';
      const result = await parser.parse(makeReq(body));

      expect(result.parsed).toEqual({ name: 'test', value: 123 });
      expect(result.raw).toBe(body);
    });

    it('parses a valid JSON array', async () => {
      const body = '[1,2,3]';
      const result = await parser.parse(makeReq(body));

      expect(result.parsed).toEqual([1, 2, 3]);
      expect(result.raw).toBe(body);
    });

    it('returns undefined parsed for an empty body', async () => {
      const result = await parser.parse(makeReq(''));

      expect(result.parsed).toBeUndefined();
      expect(result.raw).toBe('');
    });

    it('throws 400 when body is a bare string (not an object or array)', async () => {
      await expect(parser.parse(makeReq('"hello"'))).rejects.toMatchObject({
        statusCode: 400,
        details: { body: 'Invalid JSON, only supports object and array' },
      });
    });

    it('throws 400 when body is a bare number', async () => {
      await expect(parser.parse(makeReq('42'))).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 for malformed JSON', async () => {
      await expect(parser.parse(makeReq('{not json}'))).rejects.toMatchObject({ statusCode: 400 });
    });

    it('throws 400 for proto pollution attempt', async () => {
      const payload = '{"__proto__":{"polluted":true}}';
      await expect(parser.parse(makeReq(payload))).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('non-strict mode', () => {
    const parser = new JsonParser({ strict: false });

    it('parses a bare string', async () => {
      const result = await parser.parse(makeReq('"hello"'));

      expect(result.parsed).toBe('hello');
    });

    it('parses a bare number', async () => {
      const result = await parser.parse(makeReq('42'));

      expect(result.parsed).toBe(42);
    });

    it('returns undefined for an empty body', async () => {
      const result = await parser.parse(makeReq(''));

      expect(result.parsed).toBeUndefined();
    });

    it('still throws 400 for malformed JSON', async () => {
      await expect(parser.parse(makeReq('{not json}'))).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('content-length / encoding headers', () => {
    it('reads body successfully with a matching content-length and identity encoding', async () => {
      const body = '{"ok":true}';
      const req = makeReq(body, {
        'content-length': String(Buffer.byteLength(body)),
        'content-encoding': 'identity',
      });

      const result = await new JsonParser(new JsonParserOptions()).parse(req);

      expect(result.parsed).toEqual({ ok: true });
    });

    it('reads body when no content-length header is present', async () => {
      const body = '{"ok":true}';
      const req = makeReq(body, {}); // no content-length → length is undefined

      const result = await new JsonParser(new JsonParserOptions()).parse(req);

      expect(result.parsed).toEqual({ ok: true });
    });
  });

  describe('reviver option', () => {
    it('applies the reviver to parsed values', async () => {
      const reviver = (_key: string, value: unknown) =>
        typeof value === 'string' ? value.toUpperCase() : value;
      const parser = new JsonParser({ reviver });
      const body = '{"name":"test"}';

      const result = await parser.parse(makeReq(body));

      expect((result.parsed as any).name).toBe('TEST');
    });
  });
});
