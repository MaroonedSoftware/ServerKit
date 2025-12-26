import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectVisitorMeta } from '../../src/object.visitor.js';

// Create a mock for the accessSecretVersion method
const mockAccessSecretVersion = vi.fn();

// Mock the GCP Secret Manager client before importing the provider
vi.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: class MockSecretManagerServiceClient {
    accessSecretVersion = mockAccessSecretVersion;
  },
}));

// Import the provider after setting up the mock
import { AppConfigProviderGcpSecrets } from '../../src/providers/app.config.provider.gcp.secrets.js';

describe('AppConfigProviderGcpSecrets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with project ID and default regex pattern', () => {
      const provider = new AppConfigProviderGcpSecrets('my-project');
      expect(provider).toBeInstanceOf(AppConfigProviderGcpSecrets);
    });

    it('should create instance with project ID and string prefix', () => {
      const provider = new AppConfigProviderGcpSecrets('my-project', 'gcp:');
      expect(provider).toBeInstanceOf(AppConfigProviderGcpSecrets);
    });

    it('should create instance with project ID and RegExp prefix', () => {
      const provider = new AppConfigProviderGcpSecrets('my-project', /^\$\{gcp:(.+)\}$/g);
      expect(provider).toBeInstanceOf(AppConfigProviderGcpSecrets);
    });
  });

  describe('canParse()', () => {
    describe('with default regex pattern', () => {
      it('should return true for values matching default pattern', () => {
        const provider = new AppConfigProviderGcpSecrets('my-project');
        expect(provider.canParse('${gcp:MY_SECRET}')).toBe(true);
        // Reset lastIndex for global regex before next test
        provider.canParse('reset');
        expect(provider.canParse('prefix ${gcp:ANOTHER_SECRET} suffix')).toBe(true);
      });

      it('should return false for values not matching default pattern', () => {
        const provider = new AppConfigProviderGcpSecrets('my-project');
        expect(provider.canParse('gcp:MY_SECRET')).toBe(false);
        expect(provider.canParse('${MY_SECRET}')).toBe(false);
        expect(provider.canParse('MY_SECRET')).toBe(false);
      });
    });

    describe('with string prefix', () => {
      it('should convert string to RegExp and match', () => {
        const provider = new AppConfigProviderGcpSecrets('my-project', 'gcp:');
        expect(provider.canParse('gcp:MY_SECRET')).toBe(true);
        expect(provider.canParse('prefix gcp:MY_SECRET suffix')).toBe(true);
      });

      it('should return false for values not containing prefix', () => {
        const provider = new AppConfigProviderGcpSecrets('my-project', 'gcp:');
        expect(provider.canParse('env:MY_SECRET')).toBe(false);
        expect(provider.canParse('MY_SECRET')).toBe(false);
      });
    });

    describe('with RegExp prefix', () => {
      it('should return true for values matching regex', () => {
        const provider = new AppConfigProviderGcpSecrets('my-project', /^gcp:(.+)$/);
        expect(provider.canParse('gcp:MY_SECRET')).toBe(true);
      });

      it('should return false for values not matching regex', () => {
        const provider = new AppConfigProviderGcpSecrets('my-project', /^gcp:(.+)$/);
        expect(provider.canParse('env:MY_SECRET')).toBe(false);
        expect(provider.canParse('MY_SECRET')).toBe(false);
      });
    });
  });

  describe('parse()', () => {
    it('should replace value with secret from GCP', async () => {
      mockAccessSecretVersion.mockResolvedValue([
        {
          payload: {
            data: Buffer.from('secret_value'),
          },
        },
      ]);

      const provider = new AppConfigProviderGcpSecrets('my-project');
      const owner: Record<string, unknown> = { value: '${gcp:MY_SECRET}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };

      await provider.parse('${gcp:MY_SECRET}', meta);

      expect(mockAccessSecretVersion).toHaveBeenCalledWith({
        name: 'projects/my-project/secrets/MY_SECRET/versions/latest',
      });
      expect(owner.value).toBe('secret_value');
    });

    it('should handle JSON secret values', async () => {
      mockAccessSecretVersion.mockResolvedValue([
        {
          payload: {
            data: Buffer.from('{"key": "value", "number": 42}'),
          },
        },
      ]);

      const provider = new AppConfigProviderGcpSecrets('my-project');
      const owner: Record<string, unknown> = { value: '${gcp:JSON_SECRET}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };

      await provider.parse('${gcp:JSON_SECRET}', meta);

      expect(owner.value).toEqual({ key: 'value', number: 42 });
    });

    it('should handle numeric secret values', async () => {
      mockAccessSecretVersion.mockResolvedValue([
        {
          payload: {
            data: Buffer.from('42'),
          },
        },
      ]);

      const provider = new AppConfigProviderGcpSecrets('my-project');
      const owner: Record<string, unknown> = { value: '${gcp:NUMBER_SECRET}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };

      await provider.parse('${gcp:NUMBER_SECRET}', meta);

      expect(owner.value).toBe(42);
    });

    it('should handle boolean secret values', async () => {
      mockAccessSecretVersion.mockResolvedValue([
        {
          payload: {
            data: Buffer.from('true'),
          },
        },
      ]);

      const provider = new AppConfigProviderGcpSecrets('my-project');
      const owner: Record<string, unknown> = { value: '${gcp:BOOL_SECRET}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };

      await provider.parse('${gcp:BOOL_SECRET}', meta);

      expect(owner.value).toBe(true);
    });

    it('should handle errors and return empty string', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockAccessSecretVersion.mockRejectedValue(new Error('Secret not found'));

      const provider = new AppConfigProviderGcpSecrets('my-project');
      const owner: Record<string, unknown> = { value: '${gcp:MISSING_SECRET}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };

      await provider.parse('${gcp:MISSING_SECRET}', meta);

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(owner.value).toBe('');
      consoleErrorSpy.mockRestore();
    });

    it('should handle missing payload data', async () => {
      mockAccessSecretVersion.mockResolvedValue([
        {
          payload: {
            data: undefined,
          },
        },
      ]);

      const provider = new AppConfigProviderGcpSecrets('my-project');
      const owner: Record<string, unknown> = { value: '${gcp:EMPTY_SECRET}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };

      await provider.parse('${gcp:EMPTY_SECRET}', meta);

      expect(owner.value).toBe('');
    });

    it('should handle array values with arrayIndex', async () => {
      mockAccessSecretVersion.mockResolvedValue([
        {
          payload: {
            data: Buffer.from('resolved_secret'),
          },
        },
      ]);

      const provider = new AppConfigProviderGcpSecrets('my-project');
      const owner: string[] = ['${gcp:ITEM1}', 'static'];
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'items[0]',
        path: 'items[0]',
        propertyType: 'string',
        arrayIndex: 0,
      };

      await provider.parse('${gcp:ITEM1}', meta);

      expect(owner[0]).toBe('resolved_secret');
      expect(owner[1]).toBe('static');
    });

    it('should update nested object properties', async () => {
      mockAccessSecretVersion.mockResolvedValue([
        {
          payload: {
            data: Buffer.from('db_password_123'),
          },
        },
      ]);

      const provider = new AppConfigProviderGcpSecrets('my-project');
      const owner: Record<string, unknown> = {
        password: '${gcp:DB_PASSWORD}',
      };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'password',
        path: 'database.password',
        propertyType: 'string',
      };

      await provider.parse('${gcp:DB_PASSWORD}', meta);

      expect(owner.password).toBe('db_password_123');
    });

    it('should require global regex for matchAll with non-global regex', async () => {
      // Non-global regex will throw in matchAll
      const provider = new AppConfigProviderGcpSecrets('my-project', /^\$\{gcp:(.+)\}$/);
      const owner: Record<string, unknown> = { value: '${gcp:SECRET}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };

      await expect(provider.parse('${gcp:SECRET}', meta)).rejects.toThrow();
    });

    it('should work with global regex pattern', async () => {
      mockAccessSecretVersion.mockResolvedValue([
        {
          payload: {
            data: Buffer.from('secret_value'),
          },
        },
      ]);

      const provider = new AppConfigProviderGcpSecrets('my-project', /\$\{gcp:(\w+)\}/g);
      const owner: Record<string, unknown> = { value: '${gcp:MY_SECRET}' };
      const meta: ObjectVisitorMeta = {
        owner,
        propertyPath: 'value',
        path: 'value',
        propertyType: 'string',
      };

      await provider.parse('${gcp:MY_SECRET}', meta);

      expect(owner.value).toBe('secret_value');
    });
  });
});
