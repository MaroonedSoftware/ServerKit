import { describe, it, expect } from 'vitest';
import { AppConfig } from '../src/app.config.js';
import { configBoolean, configNumber, optionalConfigString, requireConfigString } from '../src/app.config.readers.js';

const config = new AppConfig<Record<string, unknown>>({
  HOST: 'db.internal',
  PORT: 5432,
  BLANK: '',
  NULLISH: 'null',
  UNSET: 'undefined',
  TYPO: 'abc',
  FLAG: true,
  OFF: 'false',
  ONE: '1',
  EMPTY: null,
  'dotted.key': 'flat wins',
  dotted: { key: 'nested' },
  database: { host: 'nested host', port: 1 },
});

describe('optionalConfigString', () => {
  it('reads a flat key, and stringifies a number or boolean', () => {
    expect(optionalConfigString(config, 'HOST')).toBe('db.internal');
    expect(optionalConfigString(config, 'PORT')).toBe('5432');
    expect(optionalConfigString(config, 'FLAG')).toBe('true');
  });

  it('reads a dotted path into a group, preferring a flat key with that name', () => {
    expect(optionalConfigString(config, 'database.host')).toBe('nested host');
    expect(optionalConfigString(config, 'dotted.key')).toBe('flat wins');
  });

  it.each(['MISSING', 'BLANK', 'NULLISH', 'UNSET', 'EMPTY', 'database', 'database.missing.deeper'])('treats %s as absent', key => {
    expect(optionalConfigString(config, key)).toBeUndefined();
  });
});

describe('requireConfigString', () => {
  it('returns a configured value and names a missing key', () => {
    expect(requireConfigString(config, 'HOST')).toBe('db.internal');
    expect(() => requireConfigString(config, 'BLANK')).toThrow('Missing required configuration: BLANK');
  });
});

describe('configNumber', () => {
  it('reads a number, a numeric string and a dotted path', () => {
    expect(configNumber(config, 'PORT')).toBe(5432);
    expect(configNumber(config, 'ONE')).toBe(1);
    expect(configNumber(config, 'database.port')).toBe(1);
  });

  it('uses the fallback when absent or unparseable', () => {
    expect(configNumber(config, 'MISSING', 7)).toBe(7);
    expect(configNumber(config, 'TYPO', 7)).toBe(7);
    expect(configNumber(config, 'MISSING', 0)).toBe(0);
  });

  it('throws without a fallback', () => {
    expect(() => configNumber(config, 'TYPO')).toThrow('TYPO must be a number (got abc)');
    expect(() => configNumber(config, 'MISSING')).toThrow('MISSING must be a number (got nothing)');
  });
});

describe('configBoolean', () => {
  it('enables on true and 1, disables on anything else present, and falls back when absent', () => {
    expect(configBoolean(config, 'FLAG')).toBe(true);
    expect(configBoolean(config, 'ONE')).toBe(true);
    expect(configBoolean(config, 'OFF', true)).toBe(false);
    expect(configBoolean(config, 'MISSING')).toBe(false);
    expect(configBoolean(config, 'MISSING', true)).toBe(true);
  });
});
