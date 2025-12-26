import { describe, it, expect } from 'vitest';
import { tryParseJson } from '../src/helpers.js';

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
      const result = tryParseJson(
        '{"string": "value", "number": 42, "bool": true, "null": null, "array": [1, 2, 3]}',
      );
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

