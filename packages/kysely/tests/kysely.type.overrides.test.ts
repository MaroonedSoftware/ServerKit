import { describe, it, expect } from 'vitest';
import { DateTime, Interval } from 'luxon';
import * as pg from 'pg';
import { KyselyPgTypeOverrides } from '../src/kysely.type.overrides.js';

const getParser = (oid: number) =>
  KyselyPgTypeOverrides.getTypeParser(oid, 'text') as unknown as (value: string) => unknown;

describe('KyselyPgTypeOverrides', () => {
  it('should be a pg.TypeOverrides instance', () => {
    expect(KyselyPgTypeOverrides).toBeInstanceOf(pg.TypeOverrides);
  });

  describe('TIMESTAMP parser', () => {
    it('should parse a TIMESTAMP string as a Luxon DateTime', () => {
      const result = getParser(pg.types.builtins.TIMESTAMP)('2023-06-15 10:30:00');
      expect(result).toBeInstanceOf(DateTime);
    });

    it('should parse with UTC zone', () => {
      const result = getParser(pg.types.builtins.TIMESTAMP)('2023-06-15 10:30:00') as DateTime;
      expect(result.zoneName).toBe('UTC');
    });

    it('should correctly parse the date and time values', () => {
      const result = getParser(pg.types.builtins.TIMESTAMP)('2023-06-15 10:30:45') as DateTime;
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
      const result = getParser(pg.types.builtins.TIMESTAMPTZ)('2023-06-15 10:30:00+00');
      expect(result).toBeInstanceOf(DateTime);
    });

    it('should parse with UTC zone', () => {
      const result = getParser(pg.types.builtins.TIMESTAMPTZ)('2023-06-15 10:30:00+00') as DateTime;
      expect(result.zoneName).toBe('UTC');
    });

    it('should correctly parse date and time values', () => {
      const result = getParser(pg.types.builtins.TIMESTAMPTZ)('2023-06-15 10:30:45+00') as DateTime;
      expect(result.year).toBe(2023);
      expect(result.month).toBe(6);
      expect(result.day).toBe(15);
    });
  });

  describe('INT8 parser', () => {
    it('should parse an INT8 string as a BigInt', () => {
      const result = getParser(pg.types.builtins.INT8)('12345');
      expect(typeof result).toBe('bigint');
    });

    it('should correctly represent the numeric value', () => {
      const result = getParser(pg.types.builtins.INT8)('12345');
      expect(result).toBe(BigInt(12345));
    });

    it('should handle large integers beyond Number.MAX_SAFE_INTEGER', () => {
      const largeValue = '9007199254740993'; // Number.MAX_SAFE_INTEGER + 2
      const result = getParser(pg.types.builtins.INT8)(largeValue);
      expect(result).toBe(BigInt(largeValue));
    });

    it('should handle negative INT8 values', () => {
      const result = getParser(pg.types.builtins.INT8)('-42');
      expect(result).toBe(BigInt(-42));
    });

    it('should handle zero', () => {
      expect(getParser(pg.types.builtins.INT8)('0')).toBe(BigInt(0));
    });
  });

  describe('INTERVAL parser', () => {
    it('should return a Luxon Interval for a bracket-delimited range string', () => {
      const result = getParser(pg.types.builtins.INTERVAL)('["2023-01-01 00:00:00","2023-12-31 23:59:59"]');
      expect(result).toBeInstanceOf(Interval);
    });

    it('should parse start and end DateTimes correctly', () => {
      const result = getParser(pg.types.builtins.INTERVAL)('["2023-01-01 00:00:00","2023-12-31 23:59:59"]') as Interval;
      expect(result.start?.year).toBe(2023);
      expect(result.start?.month).toBe(1);
      expect(result.start?.day).toBe(1);
      expect(result.end?.year).toBe(2023);
      expect(result.end?.month).toBe(12);
      expect(result.end?.day).toBe(31);
    });

    it('should support parenthesis-delimited ranges', () => {
      const result = getParser(pg.types.builtins.INTERVAL)('("2023-06-01 00:00:00","2023-06-30 00:00:00")');
      expect(result).toBeInstanceOf(Interval);
    });

    it('should support half-open ranges', () => {
      const result = getParser(pg.types.builtins.INTERVAL)('["2023-06-01 00:00:00","2023-06-30 00:00:00")');
      expect(result).toBeInstanceOf(Interval);
    });

    it('should return the original string when the format does not match', () => {
      const raw = '1 year 2 months 3 days';
      expect(getParser(pg.types.builtins.INTERVAL)(raw)).toBe(raw);
    });

    it('should return the original string for an empty string', () => {
      expect(getParser(pg.types.builtins.INTERVAL)('')).toBe('');
    });
  });

  describe('TINTERVAL parser', () => {
    it('should return a Luxon Interval for a bracket-delimited range string', () => {
      const result = getParser(pg.types.builtins.TINTERVAL)('["2023-01-01 00:00:00","2023-12-31 23:59:59"]');
      expect(result).toBeInstanceOf(Interval);
    });

    it('should parse start and end DateTimes correctly', () => {
      const result = getParser(pg.types.builtins.TINTERVAL)('["2023-03-15 08:00:00","2023-03-15 17:00:00"]') as Interval;
      expect(result.start?.hour).toBe(8);
      expect(result.end?.hour).toBe(17);
    });

    it('should return the original string when the format does not match', () => {
      const raw = '["1970-01-01 00:00:00" "1970-01-02 00:00:00"]';
      expect(getParser(pg.types.builtins.TINTERVAL)(raw)).toBe(raw);
    });
  });
});
