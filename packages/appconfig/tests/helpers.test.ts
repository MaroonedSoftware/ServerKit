import { describe, it, expect } from 'vitest';
import { tryParseJson, nestKeys } from '../src/helpers.js';

describe('tryParseJson', () => {
  describe('valid JSON parsing', () => {
    it('should parse a JSON object', () => {
      const result = tryParseJson('{"key": "value", "number": 42}');
      expect(result).toEqual({ key: 'value', number: 42 });
    });

    it('should parse a JSON array', () => {
      const result = tryParseJson('["a", "b", "c"]');
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should parse a JSON number', () => {
      expect(tryParseJson('42')).toBe(42);
      expect(tryParseJson('3.14')).toBe(3.14);
      expect(tryParseJson('-10')).toBe(-10);
      expect(tryParseJson('0')).toBe(0);
    });

    it('should parse a JSON boolean', () => {
      expect(tryParseJson('true')).toBe(true);
      expect(tryParseJson('false')).toBe(false);
    });

    it('should parse JSON null', () => {
      expect(tryParseJson('null')).toBe(null);
    });

    it('should parse a JSON string', () => {
      expect(tryParseJson('"hello"')).toBe('hello');
      expect(tryParseJson('""')).toBe('');
    });

    it('should parse nested JSON objects', () => {
      const result = tryParseJson('{"level1": {"level2": {"value": "deep"}}}');
      expect(result).toEqual({ level1: { level2: { value: 'deep' } } });
    });

    it('should parse JSON with mixed types', () => {
      const result = tryParseJson('{"string": "value", "number": 42, "bool": true, "null": null, "array": [1, 2, 3]}');
      expect(result).toEqual({
        string: 'value',
        number: 42,
        bool: true,
        null: null,
        array: [1, 2, 3],
      });
    });
  });

  describe('invalid JSON handling', () => {
    it('should return original string for invalid JSON object', () => {
      const input = '{ invalid json }';
      expect(tryParseJson(input)).toBe(input);
    });

    it('should return original string for plain text', () => {
      const input = 'hello world';
      expect(tryParseJson(input)).toBe(input);
    });

    it('should return original string for unquoted string', () => {
      const input = 'unquoted';
      expect(tryParseJson(input)).toBe(input);
    });

    it('should return original string for incomplete JSON', () => {
      expect(tryParseJson('{')).toBe('{');
      expect(tryParseJson('[')).toBe('[');
      expect(tryParseJson('{"key":')).toBe('{"key":');
    });

    it('should return original string for malformed arrays', () => {
      const input = '[1, 2, 3';
      expect(tryParseJson(input)).toBe(input);
    });

    it('should return original string for trailing commas', () => {
      const input = '{"key": "value",}';
      expect(tryParseJson(input)).toBe(input);
    });

    it('should return original string for single quotes (invalid JSON)', () => {
      const input = "{'key': 'value'}";
      expect(tryParseJson(input)).toBe(input);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(tryParseJson('')).toBe('');
    });

    it('should handle whitespace-only string', () => {
      expect(tryParseJson('   ')).toBe('   ');
    });

    it('should handle JSON with whitespace', () => {
      const result = tryParseJson('  { "key" : "value" }  ');
      expect(result).toEqual({ key: 'value' });
    });

    it('should handle special characters in strings', () => {
      const result = tryParseJson('{"value": "hello\\nworld"}');
      expect(result).toEqual({ value: 'hello\nworld' });
    });

    it('should handle unicode characters', () => {
      const result = tryParseJson('{"emoji": "👍", "chinese": "你好"}');
      expect(result).toEqual({ emoji: '👍', chinese: '你好' });
    });

    it('should handle large numbers', () => {
      expect(tryParseJson('9007199254740991')).toBe(9007199254740991);
    });

    it('should handle scientific notation', () => {
      expect(tryParseJson('1e10')).toBe(1e10);
      expect(tryParseJson('1.5e-5')).toBe(1.5e-5);
    });
  });
});

describe('nestKeys', () => {
  describe('basic grouping', () => {
    it('should group keys sharing a prefix into a nested object', () => {
      const result = nestKeys(
        {
          WEBHOOK__secret: 'blah',
          WEBHOOK__header: 'X-Signature',
          WEBHOOK__algorithm: 'sha256',
          WEBHOOK__digest: 'hex',
        },
        '__',
      );

      expect(result).toEqual({
        WEBHOOK: {
          secret: 'blah',
          header: 'X-Signature',
          algorithm: 'sha256',
          digest: 'hex',
        },
      });
    });

    it('should pass through keys that do not contain the separator', () => {
      const result = nestKeys({ DATABASE_URL: 'postgres://localhost/db', PORT: '3000' }, '__');

      expect(result).toEqual({ DATABASE_URL: 'postgres://localhost/db', PORT: '3000' });
    });

    it('should mix grouped and ungrouped keys', () => {
      const result = nestKeys(
        {
          DATABASE_URL: 'postgres://localhost/db',
          WEBHOOK__secret: 'abc',
          WEBHOOK__header: 'X-Sig',
        },
        '__',
      );

      expect(result).toEqual({
        DATABASE_URL: 'postgres://localhost/db',
        WEBHOOK: { secret: 'abc', header: 'X-Sig' },
      });
    });
  });

  describe('deep nesting', () => {
    it('should support two levels of nesting', () => {
      const result = nestKeys({ A__B__C: 'value' }, '__');

      expect(result).toEqual({ A: { B: { C: 'value' } } });
    });

    it('should support three levels of nesting', () => {
      const result = nestKeys({ A__B__C__D: 'deep' }, '__');

      expect(result).toEqual({ A: { B: { C: { D: 'deep' } } } });
    });

    it('should merge sibling sub-keys into the same parent object', () => {
      const result = nestKeys({ A__B__x: '1', A__B__y: '2', A__C: '3' }, '__');

      expect(result).toEqual({ A: { B: { x: '1', y: '2' }, C: '3' } });
    });
  });

  describe('empty and single-entry records', () => {
    it('should return an empty object for an empty record', () => {
      expect(nestKeys({}, '__')).toEqual({});
    });

    it('should handle a single ungrouped key', () => {
      expect(nestKeys({ KEY: 'value' }, '__')).toEqual({ KEY: 'value' });
    });

    it('should handle a single grouped key', () => {
      expect(nestKeys({ A__B: 'value' }, '__')).toEqual({ A: { B: 'value' } });
    });
  });

  describe('custom separators', () => {
    it('should work with a single underscore separator', () => {
      const result = nestKeys({ FOO_bar: 'baz' }, '_');
      expect(result).toEqual({ FOO: { bar: 'baz' } });
    });

    it('should work with a dot separator', () => {
      const result = nestKeys({ 'foo.bar': 'baz' }, '.');
      expect(result).toEqual({ foo: { bar: 'baz' } });
    });

    it('should work with a colon separator', () => {
      const result = nestKeys({ 'ns:key': 'val' }, ':');
      expect(result).toEqual({ ns: { key: 'val' } });
    });
  });

  describe('value preservation', () => {
    it('should preserve string values', () => {
      const result = nestKeys({ A__key: 'hello' }, '__');
      expect((result.A as Record<string, unknown>).key).toBe('hello');
    });

    it('should preserve non-string values', () => {
      const result = nestKeys({ A__num: 42, A__bool: true, A__nil: null }, '__');
      expect(result).toEqual({ A: { num: 42, bool: true, nil: null } });
    });

    it('should return a new object and not mutate the input', () => {
      const input = { A__key: 'val', OTHER: 'x' };
      const result = nestKeys(input, '__');

      expect(result).not.toBe(input);
      expect(input).toEqual({ A__key: 'val', OTHER: 'x' });
    });
  });

  describe('collision handling', () => {
    it('should overwrite a scalar value when a sub-key path requires an object at the same location', () => {
      // A was set to a string, then A__key forces A to become an object
      const result = nestKeys({ A: 'scalar', A__key: 'val' }, '__');
      expect(result).toEqual({ A: { key: 'val' } });
    });
  });
});
