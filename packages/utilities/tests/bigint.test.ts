import { describe, it, expect } from 'vitest';
import { bigIntReplacer, bigIntReviver } from '../src/bigint.js';

describe('bigIntReplacer', () => {
  it('should convert bigint to string with trailing n', () => {
    expect(bigIntReplacer('', 100n)).toBe('100n');
  });

  it('should convert negative bigint to string with trailing n', () => {
    expect(bigIntReplacer('', -42n)).toBe('-42n');
  });

  it('should convert zero bigint', () => {
    expect(bigIntReplacer('', 0n)).toBe('0n');
  });

  it('should pass through non-bigint values unchanged', () => {
    expect(bigIntReplacer('', 42)).toBe(42);
    expect(bigIntReplacer('', 'hello')).toBe('hello');
    expect(bigIntReplacer('', null)).toBe(null);
    expect(bigIntReplacer('', true)).toBe(true);
    expect(bigIntReplacer('', { a: 1 })).toEqual({ a: 1 });
  });

  it('should work as a JSON.stringify replacer', () => {
    const obj = { id: 123n, name: 'test' };
    const json = JSON.stringify(obj, bigIntReplacer);
    expect(json).toBe('{"id":"123n","name":"test"}');
  });
});

describe('bigIntReviver', () => {
  it('should convert bigint string to BigInt', () => {
    expect(bigIntReviver('', '100n')).toBe(100n);
  });

  it('should convert negative bigint string to BigInt', () => {
    expect(bigIntReviver('', '-42n')).toBe(-42n);
  });

  it('should convert zero bigint string', () => {
    expect(bigIntReviver('', '0n')).toBe(0n);
  });

  it('should pass through regular strings unchanged', () => {
    expect(bigIntReviver('', 'hello')).toBe('hello');
    expect(bigIntReviver('', '100')).toBe('100');
    expect(bigIntReviver('', 'n')).toBe('n');
  });

  it('should pass through non-string values unchanged', () => {
    expect(bigIntReviver('', 42)).toBe(42);
    expect(bigIntReviver('', null)).toBe(null);
    expect(bigIntReviver('', true)).toBe(true);
  });

  it('should work as a JSON.parse reviver', () => {
    const json = '{"id":"123n","name":"test"}';
    const obj = JSON.parse(json, bigIntReviver);
    expect(obj.id).toBe(123n);
    expect(obj.name).toBe('test');
  });
});

describe('bigInt replacer/reviver roundtrip', () => {
  it('should roundtrip a bigint through JSON', () => {
    const original = { id: 9007199254740993n };
    const json = JSON.stringify(original, bigIntReplacer);
    const restored = JSON.parse(json, bigIntReviver);
    expect(restored.id).toBe(original.id);
  });

  it('should roundtrip negative bigint through JSON', () => {
    const original = { value: -999999999999999999n };
    const json = JSON.stringify(original, bigIntReplacer);
    const restored = JSON.parse(json, bigIntReviver);
    expect(restored.value).toBe(original.value);
  });
});
