import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppConfigSourceEnv } from '../../src/sources/app.config.source.env.js';

describe('AppConfigSourceEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should create instance without options', () => {
      const source = new AppConfigSourceEnv();
      expect(source).toBeInstanceOf(AppConfigSourceEnv);
    });

    it('should create instance with options', () => {
      const source = new AppConfigSourceEnv({ groupSeparator: '__' });
      expect(source).toBeInstanceOf(AppConfigSourceEnv);
    });
  });

  describe('load()', () => {
    it('should load variables from the given environment', async () => {
      const source = new AppConfigSourceEnv({ environment: { TEST_KEY1: 'value1', TEST_KEY2: 'value2' } });
      const config = await source.load();
      expect(config.TEST_KEY1).toBe('value1');
      expect(config.TEST_KEY2).toBe('value2');
    });

    it('should read process.env by default', async () => {
      process.env.APP_CONFIG_ENV_TEST = 'from-process';
      const source = new AppConfigSourceEnv();
      const config = await source.load();
      expect(config.APP_CONFIG_ENV_TEST).toBe('from-process');
    });

    it('should return values as strings, however numeric they look', async () => {
      const source = new AppConfigSourceEnv({ environment: { PORT: '3000', DEBUG: 'true' } });
      const config = await source.load();
      expect(config.PORT).toBe('3000');
      expect(config.DEBUG).toBe('true');
    });

    it('should omit variables that are not set rather than reporting them as undefined', async () => {
      const source = new AppConfigSourceEnv({ environment: { PRESENT: 'yes', ABSENT: undefined } });
      const config = await source.load();
      expect(config).toEqual({ PRESENT: 'yes' });
      expect('ABSENT' in config).toBe(false);
    });

    it('should handle an empty environment', async () => {
      const source = new AppConfigSourceEnv({ environment: {} });
      await expect(source.load()).resolves.toEqual({});
    });

    it('should return a promise', async () => {
      const source = new AppConfigSourceEnv({ environment: { KEY: 'value' } });
      const result = source.load();
      expect(result).toBeInstanceOf(Promise);
      await result;
    });
  });

  describe('get()', () => {
    it('should fetch a single variable', async () => {
      const source = new AppConfigSourceEnv({ environment: { KEY: 'value' } });
      await expect(source.get('KEY')).resolves.toBe('value');
    });

    it('should resolve undefined for a variable that is not set', async () => {
      const source = new AppConfigSourceEnv({ environment: {} });
      await expect(source.get('MISSING')).resolves.toBeUndefined();
    });

    it('should fetch a group when grouping is on', async () => {
      const source = new AppConfigSourceEnv({ environment: { WEBHOOK__secret: 'abc' }, groupSeparator: '__' });
      await expect(source.get('WEBHOOK')).resolves.toEqual({ secret: 'abc' });
    });
  });

  describe('snapshot option', () => {
    // The reason this defaults on. An application that scrubs its secrets out of process.env after
    // boot would otherwise have them vanish from the config at the next reload, which may be hours
    // later and is triggered by something unrelated.
    it('should keep answering with the captured environment after it has changed (defaults true)', async () => {
      const environment: NodeJS.ProcessEnv = { DATABASE_PASSWORD: 'secret' };
      const source = new AppConfigSourceEnv({ environment });

      delete environment.DATABASE_PASSWORD;

      await expect(source.get('DATABASE_PASSWORD')).resolves.toBe('secret');
      await expect(source.load()).resolves.toEqual({ DATABASE_PASSWORD: 'secret' });
    });

    it('should read the current environment on every load when snapshot is false', async () => {
      const environment: NodeJS.ProcessEnv = { KEY: 'first' };
      const source = new AppConfigSourceEnv({ environment, snapshot: false });

      await expect(source.load()).resolves.toEqual({ KEY: 'first' });

      environment.KEY = 'second';
      await expect(source.load()).resolves.toEqual({ KEY: 'second' });
      await expect(source.get('KEY')).resolves.toBe('second');
    });

    it('should see a variable set after construction when snapshot is false', async () => {
      const source = new AppConfigSourceEnv({ snapshot: false });
      process.env.APP_CONFIG_ENV_LATE = 'late';
      await expect(source.get('APP_CONFIG_ENV_LATE')).resolves.toBe('late');
    });
  });

  describe('groupSeparator option', () => {
    it('should group keys by the separator into nested objects', async () => {
      const source = new AppConfigSourceEnv({
        environment: {
          PAYMENT_PROVIDER_WEBHOOK__secret: 'blah',
          PAYMENT_PROVIDER_WEBHOOK__header: 'X-Signature',
        },
        groupSeparator: '__',
      });

      await expect(source.load()).resolves.toEqual({
        PAYMENT_PROVIDER_WEBHOOK: { secret: 'blah', header: 'X-Signature' },
      });
    });

    it('should pass ungrouped keys through unchanged', async () => {
      const source = new AppConfigSourceEnv({ environment: { DATABASE_URL: 'postgres://localhost/db' }, groupSeparator: '__' });
      await expect(source.load()).resolves.toEqual({ DATABASE_URL: 'postgres://localhost/db' });
    });

    it('should support deep nesting via repeated separators', async () => {
      const source = new AppConfigSourceEnv({ environment: { A__B__C: 'deep' }, groupSeparator: '__' });
      await expect(source.load()).resolves.toEqual({ A: { B: { C: 'deep' } } });
    });

    it('should return a flat record when groupSeparator is not set', async () => {
      const source = new AppConfigSourceEnv({ environment: { A__B: 'value' } });
      await expect(source.load()).resolves.toEqual({ A__B: 'value' });
    });
  });

  describe('watch()', () => {
    it('should return a disposer that does nothing', () => {
      const source = new AppConfigSourceEnv();
      expect(() => source.watch()()).not.toThrow();
    });
  });
});
