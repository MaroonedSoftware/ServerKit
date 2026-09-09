import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  API_KEY_CHECKSUM_LENGTH,
  API_KEY_HINT_LENGTH,
  apiKeyHint,
  crc32,
  encodeBase62,
  formatApiKeyToken,
  hashApiKeyToken,
  parseApiKeyToken,
} from '../../src/apikey/api.key.token.js';

const body = encodeBase62(randomBytes(32));

describe('crc32', () => {
  // Pinned against the standard zlib/PNG polynomial. If these move, every
  // token ever issued stops parsing.
  it('matches known vectors', () => {
    expect(crc32('')).toBe(0);
    expect(crc32('a')).toBe(0xe8b7be43);
    expect(crc32('123456789')).toBe(0xcbf43926);
    expect(crc32('The quick brown fox jumps over the lazy dog')).toBe(0x414fa339);
  });
});

describe('encodeBase62', () => {
  it('returns an empty string for no bytes', () => {
    expect(encodeBase62(new Uint8Array())).toBe('');
  });

  it('encodes small values against the alphabet, padded to the width for one byte', () => {
    expect(encodeBase62(Uint8Array.from([0]))).toBe('00');
    expect(encodeBase62(Uint8Array.from([61]))).toBe('0z');
    expect(encodeBase62(Uint8Array.from([62]))).toBe('10');
    expect(encodeBase62(Uint8Array.from([255]))).toBe('47');
  });

  it('emits only base62 characters', () => {
    for (let i = 0; i < 200; i++) {
      expect(encodeBase62(randomBytes(32))).toMatch(/^[0-9A-Za-z]+$/);
    }
  });

  it('pads to a constant width regardless of the value', () => {
    // Encoding by magnitude alone would make a zero-led body come out shorter,
    // leaking information about the secret from the token's length.
    const smallest = new Uint8Array(32);
    const largest = new Uint8Array(32).fill(0xff);
    const oneLed = new Uint8Array(32);
    oneLed[31] = 1;

    expect(encodeBase62(smallest)).toHaveLength(43);
    expect(encodeBase62(oneLed)).toHaveLength(43);
    expect(encodeBase62(largest)).toHaveLength(43);

    for (let i = 0; i < 200; i++) {
      expect(encodeBase62(randomBytes(32))).toHaveLength(43);
    }
  });
});

describe('formatApiKeyToken / parseApiKeyToken', () => {
  it('round-trips a token with a type segment', () => {
    const token = formatApiKeyToken({ prefix: 'sk', type: 'live', body });

    expect(token.startsWith('sk_live_')).toBe(true);
    expect(parseApiKeyToken(token, 'sk')).toEqual({ type: 'live', body });
  });

  it('round-trips a token without a type segment', () => {
    const token = formatApiKeyToken({ prefix: 'sk', body });

    expect(token).toBe(`sk_${body}${token.slice(-API_KEY_CHECKSUM_LENGTH)}`);
    expect(parseApiKeyToken(token, 'sk')).toEqual({ body });
  });

  it('rejects a prefix or type outside the alphabet', () => {
    expect(() => formatApiKeyToken({ prefix: 'my_key', body })).toThrow(RangeError);
    expect(() => formatApiKeyToken({ prefix: 'sk', type: 'pro-d', body })).toThrow(RangeError);
    expect(() => formatApiKeyToken({ prefix: '', body })).toThrow(RangeError);
  });

  it('declines a token issued under a different prefix', () => {
    expect(parseApiKeyToken(formatApiKeyToken({ prefix: 'ghp', body }), 'sk')).toBeUndefined();
  });

  it('declines a flipped character anywhere in the token', () => {
    const token = formatApiKeyToken({ prefix: 'sk', type: 'live', body });

    // Every position after the prefix is covered by the checksum.
    for (let i = 3; i < token.length; i++) {
      const original = token[i]!;
      const replacement = original === 'a' ? 'b' : 'a';
      const mutated = `${token.slice(0, i)}${replacement}${token.slice(i + 1)}`;

      expect(parseApiKeyToken(mutated, 'sk')).toBeUndefined();
    }
  });

  it('declines a truncated token', () => {
    const token = formatApiKeyToken({ prefix: 'sk', body });

    for (let cut = 1; cut < 12; cut++) {
      expect(parseApiKeyToken(token.slice(0, -cut), 'sk')).toBeUndefined();
    }
  });

  it('declines a token whose type segment was dropped', () => {
    const token = formatApiKeyToken({ prefix: 'sk', type: 'live', body });

    expect(parseApiKeyToken(token.replace('_live_', '_'), 'sk')).toBeUndefined();
  });

  it('declines malformed shapes without throwing', () => {
    for (const bad of ['', 'sk', 'sk_', 'sk__', 'skabc', 'sk_a_b_c_d', `sk_${'x'.repeat(API_KEY_CHECKSUM_LENGTH)}`, 'sk_body+with/punctuation']) {
      expect(parseApiKeyToken(bad, 'sk')).toBeUndefined();
    }
  });

  it('does not treat a prefix that is a prefix of another as a match', () => {
    // `s` must not accept an `sk_` token: the separator is part of the check.
    expect(parseApiKeyToken(formatApiKeyToken({ prefix: 'sk', body }), 's')).toBeUndefined();
  });
});

describe('hashApiKeyToken', () => {
  it('matches a pinned vector', () => {
    // Pins the algorithm and the encoding: changing either invalidates every
    // stored hash, which would silently reject every key in production.
    expect(hashApiKeyToken('sk_live_example')).toBe('edc0244907453860f53b31a05089a2a9f0fdb349e3610b2ab88a36fd9719d7fa');
  });

  it('is stable and differs per token', () => {
    const token = formatApiKeyToken({ prefix: 'sk', body });

    expect(hashApiKeyToken(token)).toBe(hashApiKeyToken(token));
    expect(hashApiKeyToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKeyToken(token)).not.toBe(hashApiKeyToken(formatApiKeyToken({ prefix: 'sk', body: encodeBase62(randomBytes(32)) })));
  });
});

describe('apiKeyHint', () => {
  it('shows the prefix and little else', () => {
    const token = formatApiKeyToken({ prefix: 'sk', type: 'live', body });
    const hint = apiKeyHint(token);

    expect(hint).toBe(token.slice(0, API_KEY_HINT_LENGTH));
    expect(hint).toBe('sk_live_');
    expect(hint.length).toBeLessThan(token.length);
  });
});
