import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import * as pg from 'pg';
import { KyselyPgTypeOverrides } from '../src/kysely.type.overrides.js';

describe('KyselyPgTypeOverrides', () => {
  it('should be a pg.TypeOverrides instance', () => {
    expect(KyselyPgTypeOverrides).toBeInstanceOf(pg.TypeOverrides);
  });

  describe('TIMESTAMP parser', () => {
    it('should parse a TIMESTAMP string as a Luxon DateTime', () => {
      const parser = KyselyPgTypeOverrides.getTypeParser(pg.types.builtins.TIMESTAMP, 'text');
      const result = parser('2023-06-15 10:30:00');
      expect(result).toBeInstanceOf(DateTime);
    });

    it('should parse with UTC zone', () => {
      const parser = KyselyPgTypeOverrides.getTypeParser(pg.types.builtins.TIMESTAMP, 'text');
      const result = parser('2023-06-15 10:30:00') as DateTime;
      expect(result.zoneName).toBe('UTC');
    });

    it('should correctly parse the date and time values', () => {
      const parser = KyselyPgTypeOverrides.getTypeParser(pg.types.builtins.TIMESTAMP, 'text');
      const result = parser('2023-06-15 10:30:45') as DateTime;
      expect(result.year).toBe(2023);
      expect(result.month).toBe(6);
      expect(result.day).toBe(15);
      expect(result.hour).toBe(10);
      expect(result.minute).toBe(30);
      expect(result.second).toBe(45);
    });
  });

  describe('TIMESTAMPTZ parser', () => {
    it('should parse a TIMESTAMPTZ string as a Luxon DateTime', () => {
      const parser = KyselyPgTypeOverrides.getTypeParser(pg.types.builtins.TIMESTAMPTZ, 'text');
      const result = parser('2023-06-15 10:30:00+00');
      expect(result).toBeInstanceOf(DateTime);
    });

    it('should parse with UTC zone', () => {
      const parser = KyselyPgTypeOverrides.getTypeParser(pg.types.builtins.TIMESTAMPTZ, 'text');
      const result = parser('2023-06-15 10:30:00+00') as DateTime;
      expect(result.zoneName).toBe('UTC');
    });

    it('should correctly parse date and time values', () => {
      const parser = KyselyPgTypeOverrides.getTypeParser(pg.types.builtins.TIMESTAMPTZ, 'text');
      const result = parser('2023-06-15 10:30:45+00') as DateTime;
      expect(result.year).toBe(2023);
      expect(result.month).toBe(6);
      expect(result.day).toBe(15);
    });
  });

  describe('INT8 parser', () => {
    it('should parse an INT8 string as a BigInt', () => {
      const parser = KyselyPgTypeOverrides.getTypeParser(pg.types.builtins.INT8, 'text');
      const result = parser('12345');
      expect(typeof result).toBe('bigint');
    });

    it('should correctly represent the numeric value', () => {
      const parser = KyselyPgTypeOverrides.getTypeParser(pg.types.builtins.INT8, 'text');
      const result = parser('12345');
      expect(result).toBe(BigInt(12345));
    });

    it('should handle large integers beyond Number.MAX_SAFE_INTEGER', () => {
      const parser = KyselyPgTypeOverrides.getTypeParser(pg.types.builtins.INT8, 'text');
      const largeValue = '9007199254740993'; // Number.MAX_SAFE_INTEGER + 2
      const result = parser(largeValue);
      expect(result).toBe(BigInt(largeValue));
    });

    it('should handle negative INT8 values', () => {
      const parser = KyselyPgTypeOverrides.getTypeParser(pg.types.builtins.INT8, 'text');
      const result = parser('-42');
      expect(result).toBe(BigInt(-42));
    });
  });
});
