import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectVisitorMeta } from '../../src/object.visitor.js';

// Capture the config the client is constructed with, and mock the `send` method.
const mockSend = vi.fn();
const mockClientConstructor = vi.fn();

// Mock the AWS Secrets Manager client before importing the provider. `GetSecretValueCommand`
// is mocked to a simple holder so we can assert on the `SecretId` it was built with.
vi.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: class MockSecretsManagerClient {
    constructor(config: unknown) {
      mockClientConstructor(config);
    }
    send = mockSend;
  },
  GetSecretValueCommand: class MockGetSecretValueCommand {
    constructor(public readonly input: { SecretId: string }) {}
  },
}));

// Import the provider after setting up the mock
import { AppConfigProviderAwsSecrets } from '../../src/providers/app.config.provider.aws.secrets.js';

describe('AppConfigProviderAwsSecrets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with no arguments and default regex pattern', () => {
      const provider = new AppConfigProviderAwsSecrets();
      expect(provider).toBeInstanceOf(AppConfigProviderAwsSecrets);
      // No region passed → client constructed with an empty config so it falls back to the
      // standard AWS provider chain.
      expect(mockClientConstructor).toHaveBeenCalledWith({});
    });

    it('should create instance with region', () => {
      const provider = new AppConfigProviderAwsSecrets('us-east-1');
      expect(provider).toBeInstanceOf(AppConfigProviderAwsSecrets);
      expect(mockClientConstructor).toHaveBeenCalledWith({ region: 'us-east-1' });
    });

    it('should create instance with region and string prefix', () => {
      const provider = new AppConfigProviderAwsSecrets('us-east-1', 'aws:');
      expect(provider).toBeInstanceOf(AppConfigProviderAwsSecrets);
    });

    it('should create instance with region and RegExp prefix', () => {
      const provider = new AppConfigProviderAwsSecrets('us-east-1', /^\$\{aws:(.+)\}$/g);
      expect(provider).toBeInstanceOf(AppConfigProviderAwsSecrets);
    });
  });

  describe('canParse()', () => {
    describe('with default regex pattern', () => {
      it('should return true for values matching default pattern', () => {
        const provider = new AppConfigProviderAwsSecrets('us-east-1');
        expect(provider.canParse('${aws:MY_SECRET}')).toBe(true);
        expect(provider.canParse('prefix ${aws:ANOTHER_SECRET} suffix')).toBe(true);
      });

      it('should return false for values not matching default pattern', () => {
        const provider = new AppConfigProviderAwsSecrets('us-east-1');
        expect(provider.canParse('aws:MY_SECRET')).toBe(false);
        expect(provider.canParse('${MY_SECRET}')).toBe(false);
        expect(provider.canParse('MY_SECRET')).toBe(false);
      });

      it('returns true on consecutive calls with the same matching string (no stale /g lastIndex)', () => {
        // Regression: the default regex carries the /g flag, and `.test()` advances
        // `lastIndex` on every call, which used to make the second call against the
        // same string return false. Resetting `lastIndex` before each test fixes it.
        const provider = new AppConfigProviderAwsSecrets('us-east-1');
        expect(provider.canParse('${aws:MY_SECRET}')).toBe(true);
        expect(provider.canParse('${aws:MY_SECRET}')).toBe(true);
        expect(provider.canParse('${aws:MY_SECRET}')).toBe(true);
      });
    });

    describe('with string prefix', () => {
      it('should convert string to RegExp and match', () => {
        const provider = new AppConfigProviderAwsSecrets('us-east-1', 'aws:');
        expect(provider.canParse('aws:MY_SECRET')).toBe(true);
        expect(provider.canParse('prefix aws:MY_SECRET suffix')).toBe(true);
      });

      it('should return false for values not containing prefix', () => {
        const provider = new AppConfigProviderAwsSecrets('us-east-1', 'aws:');
        expect(provider.canParse('env:MY_SECRET')).toBe(false);
        expect(provider.canParse('MY_SECRET')).toBe(false);
      });
    });

    describe('with RegExp prefix', () => {
      it('should return true for values matching regex', () => {
        const provider = new AppConfigProviderAwsSecrets('us-east-1', /^aws:(.+)$/);
        expect(provider.canParse('aws:MY_SECRET')).toBe(true);
      });

      it('should return false for values not matching regex', () => {
        const provider = new AppConfigProviderAwsSecrets('us-east-1', /^aws:(.+)$/);
        expect(provider.canParse('env:MY_SECRET')).toBe(false);
        expect(provider.canParse('MY_SECRET')).toBe(false);
      });
    });
  });

  describe('parse()', () => {
    it('should replace value with secret from AWS', async () => {
      mockSend.mockResolvedValue({ SecretString: 'secret_value' });

      const provider = new AppConfigProviderAwsSecrets('us-east-1');
      const owner: Record<string, unknown> = { value: '${aws:MY_SECRET}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };

      await provider.parse('${aws:MY_SECRET}', meta);

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend.mock.calls[0]![0].input).toEqual({ SecretId: 'MY_SECRET' });
      expect(owner.value).toBe('secret_value');
    });

    it('should handle JSON secret values', async () => {
      mockSend.mockResolvedValue({ SecretString: '{"key": "value", "number": 42}' });

      const provider = new AppConfigProviderAwsSecrets('us-east-1');
      const owner: Record<string, unknown> = { value: '${aws:JSON_SECRET}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };

      await provider.parse('${aws:JSON_SECRET}', meta);

      expect(owner.value).toEqual({ key: 'value', number: 42 });
    });

    it('should handle numeric secret values', async () => {
      mockSend.mockResolvedValue({ SecretString: '42' });

      const provider = new AppConfigProviderAwsSecrets('us-east-1');
      const owner: Record<string, unknown> = { value: '${aws:NUMBER_SECRET}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };

      await provider.parse('${aws:NUMBER_SECRET}', meta);

      expect(owner.value).toBe(42);
    });

    it('should handle boolean secret values', async () => {
      mockSend.mockResolvedValue({ SecretString: 'true' });

      const provider = new AppConfigProviderAwsSecrets('us-east-1');
      const owner: Record<string, unknown> = { value: '${aws:BOOL_SECRET}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };

      await provider.parse('${aws:BOOL_SECRET}', meta);

      expect(owner.value).toBe(true);
    });

    it('should decode binary secret values to a UTF-8 string', async () => {
      mockSend.mockResolvedValue({ SecretBinary: new Uint8Array(Buffer.from('binary_secret')) });

      const provider = new AppConfigProviderAwsSecrets('us-east-1');
      const owner: Record<string, unknown> = { value: '${aws:BINARY_SECRET}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };

      await provider.parse('${aws:BINARY_SECRET}', meta);

      expect(owner.value).toBe('binary_secret');
    });

    it('throws a ServerkitError when Secrets Manager rejects, leaving the config value untouched', async () => {
      const underlying = new Error('Secret not found');
      mockSend.mockRejectedValue(underlying);

      const provider = new AppConfigProviderAwsSecrets('us-east-1');
      const owner: Record<string, unknown> = { value: '${aws:MISSING_SECRET}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };

      await expect(provider.parse('${aws:MISSING_SECRET}', meta)).rejects.toMatchObject({
        message: expect.stringContaining('MISSING_SECRET'),
        cause: underlying,
      });
      // The config value must not be silently overwritten with `''` — surfacing the
      // failure is the entire point of throwing here.
      expect(owner.value).toBe('${aws:MISSING_SECRET}');
    });

    it('should handle a response with neither SecretString nor SecretBinary', async () => {
      mockSend.mockResolvedValue({});

      const provider = new AppConfigProviderAwsSecrets('us-east-1');
      const owner: Record<string, unknown> = { value: '${aws:EMPTY_SECRET}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };

      await provider.parse('${aws:EMPTY_SECRET}', meta);

      expect(owner.value).toBe('');
    });

    it('should handle array values with arrayIndex', async () => {
      mockSend.mockResolvedValue({ SecretString: 'resolved_secret' });

      const provider = new AppConfigProviderAwsSecrets('us-east-1');
      const owner: string[] = ['${aws:ITEM1}', 'static'];
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'items[0]',
        path: 'items[0]',
        propertyType: 'string',
        arrayIndex: 0,
      };

      await provider.parse('${aws:ITEM1}', meta);

      expect(owner[0]).toBe('resolved_secret');
      expect(owner[1]).toBe('static');
    });

    it('should update nested object properties', async () => {
      mockSend.mockResolvedValue({ SecretString: 'db_password_123' });

      const provider = new AppConfigProviderAwsSecrets('us-east-1');
      const owner: Record<string, unknown> = {
        password: '${aws:DB_PASSWORD}',
      };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'password',
        path: 'database.password',
        propertyType: 'string',
      };

      await provider.parse('${aws:DB_PASSWORD}', meta);

      expect(owner.password).toBe('db_password_123');
    });

    it('should require global regex for matchAll with non-global regex', async () => {
      // Non-global regex will throw in matchAll
      const provider = new AppConfigProviderAwsSecrets('us-east-1', /^\$\{aws:(.+)\}$/);
      const owner: Record<string, unknown> = { value: '${aws:SECRET}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };

      await expect(provider.parse('${aws:SECRET}', meta)).rejects.toThrow();
    });

    it('should work with global regex pattern', async () => {
      mockSend.mockResolvedValue({ SecretString: 'secret_value' });

      const provider = new AppConfigProviderAwsSecrets('us-east-1', /\$\{aws:(\w+)\}/g);
      const owner: Record<string, unknown> = { value: '${aws:MY_SECRET}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };

      await provider.parse('${aws:MY_SECRET}', meta);

      expect(owner.value).toBe('secret_value');
    });
  });
});
