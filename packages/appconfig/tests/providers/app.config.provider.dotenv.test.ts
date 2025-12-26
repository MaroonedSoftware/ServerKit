import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AppConfigProviderDotenv } from '../../src/providers/app.config.provider.dotenv.js';
import { ObjectVisitorMeta } from '../../src/object.visitor.js';

describe('AppConfigProviderDotenv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('constructor', () => {
    it('should create instance with default regex pattern', () => {
      const provider = new AppConfigProviderDotenv();
      expect(provider).toBeInstanceOf(AppConfigProviderDotenv);
    });

    it('should create instance with string prefix', () => {
      const provider = new AppConfigProviderDotenv('env:');
      expect(provider).toBeInstanceOf(AppConfigProviderDotenv);
    });

    it('should create instance with RegExp prefix', () => {
      const provider = new AppConfigProviderDotenv(/^env:(.+)$/);
      expect(provider).toBeInstanceOf(AppConfigProviderDotenv);
    });
  });

  describe('canParse()', () => {
    describe('with default regex pattern', () => {
      it('should return true for values matching default pattern', () => {
        const provider = new AppConfigProviderDotenv();
        expect(provider.canParse('${env:TEST_KEY}')).toBe(true);
        // Reset lastIndex for global regex before next test
        provider.canParse('reset');
        expect(provider.canParse('prefix ${env:ANOTHER_KEY} suffix')).toBe(true);
      });

      it('should return false for values not matching default pattern', () => {
        const provider = new AppConfigProviderDotenv();
        expect(provider.canParse('env:TEST_KEY')).toBe(false);
        expect(provider.canParse('${TEST_KEY}')).toBe(false);
        expect(provider.canParse('TEST_KEY')).toBe(false);
      });
    });

    describe('with string prefix', () => {
      it('should convert string to RegExp and match anywhere in string', () => {
        const provider = new AppConfigProviderDotenv('env:');
        expect(provider.canParse('env:TEST_KEY')).toBe(true);
        expect(provider.canParse('prefix env:TEST_KEY suffix')).toBe(true);
        expect(provider.canParse('env:ANOTHER_KEY')).toBe(true);
      });

      it('should return false for values not containing prefix', () => {
        const provider = new AppConfigProviderDotenv('env:');
        expect(provider.canParse('test:TEST_KEY')).toBe(false);
        expect(provider.canParse('TEST_KEY')).toBe(false);
        expect(provider.canParse('')).toBe(false);
      });
    });

    describe('with RegExp prefix', () => {
      it('should return true for values matching regex', () => {
        const provider = new AppConfigProviderDotenv(/^env:(.+)$/);
        expect(provider.canParse('env:TEST_KEY')).toBe(true);
        expect(provider.canParse('env:ANOTHER_KEY')).toBe(true);
      });

      it('should return false for values not matching regex', () => {
        const provider = new AppConfigProviderDotenv(/^env:(.+)$/);
        expect(provider.canParse('test:TEST_KEY')).toBe(false);
        expect(provider.canParse('TEST_KEY')).toBe(false);
      });

      it('should work with custom regex patterns', () => {
        const provider = new AppConfigProviderDotenv(/^\$\{([^}]+)\}$/);
        expect(provider.canParse('${TEST_KEY}')).toBe(true);
        expect(provider.canParse('${ANOTHER_KEY}')).toBe(true);
        expect(provider.canParse('env:TEST_KEY')).toBe(false);
      });
    });
  });

  describe('parse()', () => {
    describe('with default regex pattern', () => {
      it('should replace value with environment variable', async () => {
        // The default regex /\$\{env:(.+)\}/g captures the key part (TEST_KEY) in the first group
        process.env['TEST_KEY'] = 'test_value';
        const provider = new AppConfigProviderDotenv();
        const owner: Record<string, unknown> = { value: '${env:TEST_KEY}' };
        const meta: ObjectVisitorMeta = {
          owner,
          propertyPath: 'value',
          path: 'value',
          propertyType: 'string',
        };
        await provider.parse('${env:TEST_KEY}', meta);
        expect(owner.value).toBe('test_value');
      });

      it('should handle missing environment variable', async () => {
        delete process.env.MISSING_KEY;
        const provider = new AppConfigProviderDotenv();
        const owner: Record<string, unknown> = { value: '${env:MISSING_KEY}' };
        const meta: ObjectVisitorMeta = {
          owner,
          propertyPath: 'value',
          path: 'value',
          propertyType: 'string',
        };
        await provider.parse('${env:MISSING_KEY}', meta);
        expect(owner.value).toBe('');
      });

      it('should handle single replacement in string', async () => {
        // Default regex matches anywhere in the string (no ^ anchor)
        process.env['HOST'] = 'localhost';
        const provider = new AppConfigProviderDotenv();
        const owner: Record<string, unknown> = {
          value: 'http://${env:HOST}:3000',
        };
        const meta: ObjectVisitorMeta = {
          owner,
          propertyPath: 'value',
          path: 'value',
          propertyType: 'string',
        };
        await provider.parse('http://${env:HOST}:3000', meta);
        expect(owner.value).toBe('http://localhost:3000');
      });

      it('should parse JSON values from environment', async () => {
        // The regex captures just the key part (JSON_KEY) in the first capture group
        process.env['JSON_KEY'] = '{"key": "value", "number": 42}';
        const provider = new AppConfigProviderDotenv();
        const owner: Record<string, unknown> = { value: '${env:JSON_KEY}' };
        const meta: ObjectVisitorMeta = {
          owner,
          propertyPath: 'value',
          path: 'value',
          propertyType: 'string',
        };
        await provider.parse('${env:JSON_KEY}', meta);
        expect(owner.value).toEqual({ key: 'value', number: 42 });
      });
    });

    describe('with string prefix', () => {
      it('should require global regex for matchAll', async () => {
        // String 'env:' becomes RegExp('env:') which is not global
        // matchAll requires a global regex, so this will throw
        const provider = new AppConfigProviderDotenv('env:');
        const owner: Record<string, unknown> = { value: 'env:TEST_KEY' };
        const meta: ObjectVisitorMeta = {
          owner,
          propertyPath: 'value',
          path: 'value',
          propertyType: 'string',
        };
        // matchAll throws if regex is not global
        await expect(provider.parse('env:TEST_KEY', meta)).rejects.toThrow();
      });

      it('should handle invalid JSON and return string', async () => {
        process.env['INVALID_JSON'] = '{invalid json}';
        const provider = new AppConfigProviderDotenv();
        const owner: Record<string, unknown> = { value: '${env:INVALID_JSON}' };
        const meta: ObjectVisitorMeta = {
          owner,
          propertyPath: 'value',
          path: 'value',
          propertyType: 'string',
        };
        await provider.parse('${env:INVALID_JSON}', meta);
        expect(owner.value).toBe('{invalid json}');
      });

      it('should handle numeric JSON values', async () => {
        process.env['NUMBER_KEY'] = '42';
        const provider = new AppConfigProviderDotenv();
        const owner: Record<string, unknown> = { value: '${env:NUMBER_KEY}' };
        const meta: ObjectVisitorMeta = {
          owner,
          propertyPath: 'value',
          path: 'value',
          propertyType: 'string',
        };
        await provider.parse('${env:NUMBER_KEY}', meta);
        expect(owner.value).toBe(42);
      });

      it('should handle boolean JSON values', async () => {
        process.env['BOOL_KEY'] = 'true';
        const provider = new AppConfigProviderDotenv();
        const owner: Record<string, unknown> = { value: '${env:BOOL_KEY}' };
        const meta: ObjectVisitorMeta = {
          owner,
          propertyPath: 'value',
          path: 'value',
          propertyType: 'string',
        };
        await provider.parse('${env:BOOL_KEY}', meta);
        expect(owner.value).toBe(true);
      });

      it('should handle array JSON values', async () => {
        process.env['ARRAY_KEY'] = '["a", "b", "c"]';
        const provider = new AppConfigProviderDotenv();
        const owner: Record<string, unknown> = { value: '${env:ARRAY_KEY}' };
        const meta: ObjectVisitorMeta = {
          owner,
          propertyPath: 'value',
          path: 'value',
          propertyType: 'string',
        };
        await provider.parse('${env:ARRAY_KEY}', meta);
        expect(owner.value).toEqual(['a', 'b', 'c']);
      });
    });

    describe('with RegExp prefix', () => {
      it('should require global regex for matchAll', async () => {
        // Non-global regex will throw in matchAll
        const provider = new AppConfigProviderDotenv(/^env:(.+)$/);
        const owner: Record<string, unknown> = { value: 'env:TEST_KEY' };
        const meta: ObjectVisitorMeta = {
          owner,
          propertyPath: 'value',
          path: 'value',
          propertyType: 'string',
        };
        await expect(provider.parse('env:TEST_KEY', meta)).rejects.toThrow();
      });

      it('should work with custom global regex pattern', async () => {
        process.env.TEST_KEY = 'test_value';
        const provider = new AppConfigProviderDotenv(/^\$\{([^}]+)\}$/g);
        const owner: Record<string, unknown> = { value: '${TEST_KEY}' };
        const meta: ObjectVisitorMeta = {
          owner,
          propertyPath: 'value',
          path: 'value',
          propertyType: 'string',
        };
        await provider.parse('${TEST_KEY}', meta);
        expect(owner.value).toBe('test_value');
      });

      it('should handle multiple matches with global regex', async () => {
        process.env.HOST = 'localhost';
        process.env.PORT = '3000';
        const provider = new AppConfigProviderDotenv(/\$\{env:(\w+)\}/g);
        const owner: Record<string, unknown> = {
          value: 'http://${env:HOST}:${env:PORT}',
        };
        const meta: ObjectVisitorMeta = {
          owner,
          propertyPath: 'value',
          path: 'value',
          propertyType: 'string',
        };
        await provider.parse('http://${env:HOST}:${env:PORT}', meta);
        expect(owner.value).toBe('http://localhost:3000');
      });

      it('should handle regex without capture group', async () => {
        process.env.TEST_KEY = 'test_value';
        const provider = new AppConfigProviderDotenv(/^env:/g);
        const owner: Record<string, unknown> = { value: 'env:TEST_KEY' };
        const meta: ObjectVisitorMeta = {
          owner,
          propertyPath: 'value',
          path: 'value',
          propertyType: 'string',
        };
        await provider.parse('env:TEST_KEY', meta);
        // Without capture group, key is undefined, so process.env[undefined] is undefined
        // replaceAll replaces 'env:' with '', resulting in 'TEST_KEY'
        // Then tryParseJson is called on 'TEST_KEY', which remains as string
        expect(owner.value).toBe('TEST_KEY');
      });

      it('should handle non-matching regex', async () => {
        const provider = new AppConfigProviderDotenv(/^env:(.+)$/g);
        const owner: Record<string, unknown> = { value: 'invalid' };
        const meta: ObjectVisitorMeta = {
          owner,
          propertyPath: 'value',
          path: 'value',
          propertyType: 'string',
        };
        await provider.parse('invalid', meta);
        // matchAll returns empty iterator, so no replacements occur
        // Then tryParseJson is called on original value
        expect(owner.value).toBe('invalid');
      });
    });

    it('should update the correct property in nested objects', async () => {
      process.env['DB_HOST'] = 'localhost';
      const provider = new AppConfigProviderDotenv();
      const owner: Record<string, unknown> = {
        database: {
          host: '${env:DB_HOST}',
        },
      };
      const meta: ObjectVisitorMeta = {
        owner: owner.database as Record<string, unknown>,
        propertyPath: 'host',
        path: 'database.host',
        propertyType: 'string',
      };
      await provider.parse('${env:DB_HOST}', meta);
      expect((owner.database as Record<string, unknown>).host).toBe('localhost');
    });

    it('should handle replacement anywhere in string with default regex', async () => {
      // Default regex matches anywhere in the string (no ^ anchor)
      process.env['API_URL'] = 'https://api.example.com';
      const provider = new AppConfigProviderDotenv();
      const owner: Record<string, unknown> = {
        value: 'Base URL: ${env:API_URL}/v1',
      };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };
      await provider.parse('Base URL: ${env:API_URL}/v1', meta);
      expect(owner.value).toBe('Base URL: https://api.example.com/v1');
    });

    it('should handle empty string result', async () => {
      process.env['EMPTY_KEY'] = '';
      const provider = new AppConfigProviderDotenv();
      const owner: Record<string, unknown> = { value: '${env:EMPTY_KEY}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };
      await provider.parse('${env:EMPTY_KEY}', meta);
      // Empty string gets parsed as JSON, which returns empty string
      expect(owner.value).toBe('');
    });
  });
});
