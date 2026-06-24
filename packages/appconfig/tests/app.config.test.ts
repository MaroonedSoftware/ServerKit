import { describe, it, expect, expectTypeOf } from 'vitest';
import { AppConfig } from '../src/app.config.js';

describe('AppConfig', () => {
  describe('constructor', () => {
    it('should create an AppConfig instance with the provided config', () => {
      const config = { key1: 'value1', key2: 42 };
      const appConfig = new AppConfig(config);
      expect(appConfig).toBeInstanceOf(AppConfig);
    });
  });

  describe('get()', () => {
    it('should return the value for a given key', () => {
      const config = { key1: 'value1', key2: 42 };
      const appConfig = new AppConfig(config);
      expect(appConfig.get('key1')).toBe('value1');
      expect(appConfig.get('key2')).toBe(42);
    });

    it('should return undefined for non-existent keys', () => {
      const config = { key1: 'value1' };
      const appConfig = new AppConfig(config);
      // TypeScript will prevent this, but at runtime it returns undefined
      expect((appConfig as unknown as AppConfig<Record<string, unknown>>).get('nonexistent')).toBeUndefined();
    });

    it('should work with nested objects', () => {
      const config = {
        database: {
          host: 'localhost',
          port: 5432,
        },
      };
      const appConfig = new AppConfig(config);
      expect(appConfig.get('database')).toEqual({
        host: 'localhost',
        port: 5432,
      });
    });

    it('should work with arrays', () => {
      const config = {
        items: [1, 2, 3],
      };
      const appConfig = new AppConfig(config);
      expect(appConfig.get('items')).toEqual([1, 2, 3]);
    });

    it('should preserve type information', () => {
      interface TestConfig {
        name: string;
        age: number;
        active: boolean;
      }
      const config: TestConfig = {
        name: 'John',
        age: 30,
        active: true,
      };
      const appConfig = new AppConfig(config);
      const name = appConfig.get('name');
      const age = appConfig.get('age');
      const active = appConfig.get('active');

      expect(typeof name).toBe('string');
      expect(typeof age).toBe('number');
      expect(typeof active).toBe('boolean');
      expect(name).toBe('John');
      expect(age).toBe(30);
      expect(active).toBe(true);
    });

    it('should return the default value when the value is missing', () => {
      const config: Record<string, unknown> = { present: 'value', nullValue: null, undefinedValue: undefined };
      const appConfig = new AppConfig(config);
      expect(appConfig.get('missing', 'fallback')).toBe('fallback');
      expect(appConfig.get('nullValue', 'fallback')).toBe('fallback');
      expect(appConfig.get('undefinedValue', 'fallback')).toBe('fallback');
      expect(appConfig.get('present', 'fallback')).toBe('value');
    });

    it('should not apply the default value for falsy-but-present values', () => {
      const config = { zero: 0, empty: '', disabled: false };
      const appConfig = new AppConfig(config);
      expect(appConfig.get('zero', 99)).toBe(0);
      expect(appConfig.get('empty', 'fallback')).toBe('');
      expect(appConfig.get('disabled', true)).toBe(false);
    });

    it('should infer the default value type for loosely-typed configs', () => {
      const config: Record<string, unknown> = { GOOGLE_OIDC_ISSUER: undefined };
      const appConfig = new AppConfig(config);
      const issuer = appConfig.get('GOOGLE_OIDC_ISSUER', 'https://accounts.google.com');
      expectTypeOf(issuer).toEqualTypeOf<string>();
      expect(issuer).toBe('https://accounts.google.com');
    });

    it('should preserve the precise value type for typed configs', () => {
      interface TypedConfig {
        port: number;
        host?: string;
      }
      const appConfig = new AppConfig<TypedConfig>({ port: 3000 });
      expectTypeOf(appConfig.get('port', 8080)).toEqualTypeOf<number>();
      expectTypeOf(appConfig.get('host', 'localhost')).toEqualTypeOf<string>();
    });
  });

  describe('has()', () => {
    it('should return true for present values', () => {
      const config = { name: 'John', count: 0, enabled: false, empty: '' };
      const appConfig = new AppConfig(config);
      expect(appConfig.has('name')).toBe(true);
      expect(appConfig.has('count')).toBe(true);
      expect(appConfig.has('enabled')).toBe(true);
      expect(appConfig.has('empty')).toBe(true);
    });

    it('should return false for null and undefined values', () => {
      const config: Record<string, unknown> = { nullValue: null, undefinedValue: undefined };
      const appConfig = new AppConfig(config);
      expect(appConfig.has('nullValue')).toBe(false);
      expect(appConfig.has('undefinedValue')).toBe(false);
    });

    it('should return false for keys that are not present', () => {
      const config: Record<string, unknown> = { key1: 'value1' };
      const appConfig = new AppConfig(config);
      expect(appConfig.has('nonexistent')).toBe(false);
    });
  });

  describe('getAs()', () => {
    it('should cast the value to the specified type', () => {
      interface DbConfig { host: string; port: number }
      const config = new AppConfig({ database: { host: 'localhost', port: 5432 } });
      const db = config.getAs<DbConfig>('database');
      expect(db.host).toBe('localhost');
      expect(db.port).toBe(5432);
    });

    it('should return the raw value with no transformation', () => {
      const config = new AppConfig({ count: 42 });
      const count = config.getAs<number>('count');
      expect(count).toBe(42);
    });

    it('should cast arrays to a typed array', () => {
      const config = new AppConfig({ tags: ['a', 'b', 'c'] });
      const tags = config.getAs<string[]>('tags');
      expect(tags).toEqual(['a', 'b', 'c']);
    });
  });

  describe('getString()', () => {
    it('should convert number to string', () => {
      const config = { port: 3000, count: 42 };
      const appConfig = new AppConfig(config);
      expect(appConfig.getString('port')).toBe('3000');
      expect(appConfig.getString('count')).toBe('42');
    });

    it('should convert boolean to string', () => {
      const config = { enabled: true, disabled: false };
      const appConfig = new AppConfig(config);
      expect(appConfig.getString('enabled')).toBe('true');
      expect(appConfig.getString('disabled')).toBe('false');
    });

    it('should return string as-is', () => {
      const config = { name: 'John', value: 'test' };
      const appConfig = new AppConfig(config);
      expect(appConfig.getString('name')).toBe('John');
      expect(appConfig.getString('value')).toBe('test');
    });

    it('should convert null and undefined to string', () => {
      const config: Record<string, unknown> = {
        nullValue: null,
        undefinedValue: undefined,
      };
      const appConfig = new AppConfig(config);
      expect(appConfig.getString('nullValue')).toBe('null');
      expect(appConfig.getString('undefinedValue')).toBe('undefined');
    });

    it('should convert object to string', () => {
      const config = { obj: { key: 'value' } };
      const appConfig = new AppConfig(config);
      expect(appConfig.getString('obj')).toBe('[object Object]');
    });
  });

  describe('getNumber()', () => {
    it('should convert string to number', () => {
      const config = { port: '3000', timeout: '5000' };
      const appConfig = new AppConfig(config);
      expect(appConfig.getNumber('port')).toBe(3000);
      expect(appConfig.getNumber('timeout')).toBe(5000);
    });

    it('should return number as-is', () => {
      const config = { port: 3000, count: 42 };
      const appConfig = new AppConfig(config);
      expect(appConfig.getNumber('port')).toBe(3000);
      expect(appConfig.getNumber('count')).toBe(42);
    });

    it('should convert boolean to number', () => {
      const config = { enabled: true, disabled: false };
      const appConfig = new AppConfig(config);
      expect(appConfig.getNumber('enabled')).toBe(1);
      expect(appConfig.getNumber('disabled')).toBe(0);
    });

    it('should return NaN for invalid conversions', () => {
      const config = { invalid: 'not a number', empty: '' };
      const appConfig = new AppConfig(config);
      expect(appConfig.getNumber('invalid')).toBeNaN();
      expect(appConfig.getNumber('empty')).toBe(0);
    });

    it('should convert null and undefined to number', () => {
      const config: Record<string, unknown> = {
        nullValue: null,
        undefinedValue: undefined,
      };
      const appConfig = new AppConfig(config);
      expect(appConfig.getNumber('nullValue')).toBe(0);
      expect(appConfig.getNumber('undefinedValue')).toBeNaN();
    });
  });

  describe('getBoolean()', () => {
    it('should convert string to boolean', () => {
      const config = { enabled: 'true', disabled: 'false', empty: '' };
      const appConfig = new AppConfig(config);
      expect(appConfig.getBoolean('enabled')).toBe(true);
      expect(appConfig.getBoolean('disabled')).toBe(true); // Non-empty string is truthy
      expect(appConfig.getBoolean('empty')).toBe(false);
    });

    it('should return boolean as-is', () => {
      const config = { enabled: true, disabled: false };
      const appConfig = new AppConfig(config);
      expect(appConfig.getBoolean('enabled')).toBe(true);
      expect(appConfig.getBoolean('disabled')).toBe(false);
    });

    it('should convert number to boolean', () => {
      const config = { zero: 0, one: 1, negative: -1 };
      const appConfig = new AppConfig(config);
      expect(appConfig.getBoolean('zero')).toBe(false);
      expect(appConfig.getBoolean('one')).toBe(true);
      expect(appConfig.getBoolean('negative')).toBe(true);
    });

    it('should convert null and undefined to boolean', () => {
      const config: Record<string, unknown> = {
        nullValue: null,
        undefinedValue: undefined,
      };
      const appConfig = new AppConfig(config);
      expect(appConfig.getBoolean('nullValue')).toBe(false);
      expect(appConfig.getBoolean('undefinedValue')).toBe(false);
    });

    it('should convert object to boolean', () => {
      const config = { obj: { key: 'value' }, emptyObj: {} };
      const appConfig = new AppConfig(config);
      expect(appConfig.getBoolean('obj')).toBe(true);
      expect(appConfig.getBoolean('emptyObj')).toBe(true);
    });
  });

  describe('supplier-backed config', () => {
    it('should re-evaluate every read against the supplier', () => {
      let backing: Record<string, unknown> = { port: 3000, mode: 'a' };
      const appConfig = new AppConfig(() => backing);

      expect(appConfig.get('port')).toBe(3000);
      expect(appConfig.getString('mode')).toBe('a');
      expect(appConfig.has('extra')).toBe(false);

      backing = { port: 4000, mode: 'b', extra: true };

      expect(appConfig.getNumber('port')).toBe(4000);
      expect(appConfig.getString('mode')).toBe('b');
      expect(appConfig.has('extra')).toBe(true);
      expect(appConfig.getBoolean('extra')).toBe(true);
    });

    it('should behave identically to a plain config for a constant supplier', () => {
      const plain = new AppConfig({ a: 1 });
      const supplied = new AppConfig(() => ({ a: 1 }));
      expect(supplied.get('a')).toBe(plain.get('a'));
    });
  });

  describe('toObject()', () => {
    it('should return the backing config object', () => {
      const config = { a: 1, b: 'two' };
      expect(new AppConfig(config).toObject()).toEqual(config);
    });

    it('should return the current snapshot for a supplier-backed config', () => {
      let backing = { a: 1 };
      const appConfig = new AppConfig(() => backing);
      expect(appConfig.toObject()).toEqual({ a: 1 });
      backing = { a: 2 };
      expect(appConfig.toObject()).toEqual({ a: 2 });
    });
  });

  describe('getObject()', () => {
    it('should return object as-is', () => {
      const config = {
        database: { host: 'localhost', port: 5432 },
        api: { timeout: 5000 },
      };
      const appConfig = new AppConfig(config);
      expect(appConfig.getObject('database')).toEqual({
        host: 'localhost',
        port: 5432,
      });
      expect(appConfig.getObject('api')).toEqual({ timeout: 5000 });
    });

    it('should cast array to object', () => {
      const config = { items: [1, 2, 3] };
      const appConfig = new AppConfig(config);
      const items = appConfig.getObject('items');
      expect(Array.isArray(items)).toBe(true);
      expect(items).toEqual([1, 2, 3]);
    });

    it('should cast null to object', () => {
      const config: Record<string, unknown> = { nullValue: null };
      const appConfig = new AppConfig(config);
      expect(appConfig.getObject('nullValue')).toBe(null);
    });
  });
});
