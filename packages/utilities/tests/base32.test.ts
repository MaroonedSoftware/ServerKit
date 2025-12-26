import { describe, it, expect } from 'vitest';
import { base32Decode, base32Encode } from '../src/base32.js';

describe('base32Decode', () => {
  it('should decode a valid base32 string', () => {
    // "JBSWY3DPEE" is base32 for "Hello!" (6 bytes)
    const result = base32Decode('JBSWY3DPEE');
    const expected = new Uint8Array([72, 101, 108, 108, 111, 33]);
    expect(result).toEqual(expected);
  });

  it('should decode lowercase base32 strings', () => {
    const result = base32Decode('jbswy3dpee');
    const expected = new Uint8Array([72, 101, 108, 108, 111, 33]);
    expect(result).toEqual(expected);
  });

  it('should decode mixed case base32 strings', () => {
    const result = base32Decode('JbSwY3DpEe');
    const expected = new Uint8Array([72, 101, 108, 108, 111, 33]);
    expect(result).toEqual(expected);
  });

  it('should decode base32 strings with padding', () => {
    // "MY======" is base32 for "f"
    const result = base32Decode('MY======');
    const expected = new Uint8Array([102]);
    expect(result).toEqual(expected);
  });

  it('should decode base32 strings without padding', () => {
    // "MY" is base32 for "f" without padding
    const result = base32Decode('MY');
    const expected = new Uint8Array([102]);
    expect(result).toEqual(expected);
  });

  it('should decode base32 strings with spaces', () => {
    const result = base32Decode('JBSW Y3DP EE');
    const expected = new Uint8Array([72, 101, 108, 108, 111, 33]);
    expect(result).toEqual(expected);
  });

  it('should decode an empty string', () => {
    const result = base32Decode('');
    expect(result).toEqual(new Uint8Array([]));
  });

  it('should throw TypeError for invalid characters', () => {
    expect(() => base32Decode('INVALID!CHARS')).toThrow(TypeError);
    expect(() => base32Decode('INVALID!CHARS')).toThrow('Invalid character found: !');
  });

  it('should throw for character 0 (not in RFC 4648 alphabet)', () => {
    expect(() => base32Decode('A0')).toThrow(TypeError);
    expect(() => base32Decode('A0')).toThrow('Invalid character found: 0');
  });

  it('should throw for character 1 (not in RFC 4648 alphabet)', () => {
    expect(() => base32Decode('A1')).toThrow(TypeError);
    expect(() => base32Decode('A1')).toThrow('Invalid character found: 1');
  });

  it('should decode a TOTP-style secret', () => {
    // Common TOTP secret format
    const result = base32Decode('GEZDGNBVGY3TQOJQ');
    const expected = new Uint8Array([49, 50, 51, 52, 53, 54, 55, 56, 57, 48]);
    expect(result).toEqual(expected);
  });
});

describe('base32Encode', () => {
  it('should encode a Uint8Array to base32 with padding by default', () => {
    const input = new Uint8Array([72, 101, 108, 108, 111, 33]);
    const result = base32Encode(input);
    expect(result).toBe('JBSWY3DPEE======');
  });

  it('should encode a single byte with padding', () => {
    const input = new Uint8Array([102]);
    const result = base32Encode(input);
    expect(result).toBe('MY======');
  });

  it('should encode without padding when padding=false', () => {
    const input = new Uint8Array([102]);
    const result = base32Encode(input, false);
    expect(result).toBe('MY');
  });

  it('should encode an empty Uint8Array', () => {
    const result = base32Encode(new Uint8Array([]));
    expect(result).toBe('');
  });

  it('should encode without padding when padding=false for longer input', () => {
    const input = new Uint8Array([72, 101, 108, 108, 111, 33]);
    const result = base32Encode(input, false);
    expect(result).toBe('JBSWY3DPEE');
  });

  it('should produce valid padding lengths', () => {
    // 1 byte -> 2 chars + 6 padding
    expect(base32Encode(new Uint8Array([0]))).toBe('AA======');
    // 2 bytes -> 4 chars + 4 padding
    expect(base32Encode(new Uint8Array([0, 0]))).toBe('AAAA====');
    // 3 bytes -> 5 chars + 3 padding
    expect(base32Encode(new Uint8Array([0, 0, 0]))).toBe('AAAAA===');
    // 4 bytes -> 7 chars + 1 padding
    expect(base32Encode(new Uint8Array([0, 0, 0, 0]))).toBe('AAAAAAA=');
    // 5 bytes -> 8 chars + 0 padding
    expect(base32Encode(new Uint8Array([0, 0, 0, 0, 0]))).toBe('AAAAAAAA');
  });
});

describe('base32 roundtrip', () => {
  it('should correctly roundtrip encode/decode', () => {
    const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const encoded = base32Encode(original);
    const decoded = base32Decode(encoded);
    expect(decoded).toEqual(original);
  });

  it('should correctly roundtrip with random bytes', () => {
    const original = new Uint8Array([0x00, 0xff, 0x7f, 0x80, 0x55, 0xaa, 0x12, 0x34]);
    const encoded = base32Encode(original);
    const decoded = base32Decode(encoded);
    expect(decoded).toEqual(original);
  });

  it('should correctly roundtrip without padding', () => {
    const original = new Uint8Array([100, 200, 50]);
    const encoded = base32Encode(original, false);
    const decoded = base32Decode(encoded);
    expect(decoded).toEqual(original);
  });
});
