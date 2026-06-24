import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture the config the client is constructed with, and mock `send` to dispatch on the
// command type so a single source can both list and fetch secrets in one test. Every
// closure these reference must be `mock`-prefixed — vitest hoists the factory above the
// file and only permits `mock*` references inside it.
const mockClientConstructor = vi.fn();
const mockListSecrets = vi.fn();
const mockGet = vi.fn();
const mockBatch = vi.fn();
const mockSecretValues = new Map<string, { SecretString?: string; SecretBinary?: Buffer }>();
const mockMissingSecrets = new Set<string>();

// Mock the AWS Secrets Manager client before importing the source under test. The command
// classes are defined inside the factory so they exist when the hoisted factory runs.
vi.mock('@aws-sdk/client-secrets-manager', () => {
  class MockListSecretsCommand {
    constructor(public readonly input: { Filters?: unknown; NextToken?: string }) {}
  }
  class MockGetSecretValueCommand {
    constructor(public readonly input: { SecretId: string }) {}
  }
  class MockBatchGetSecretValueCommand {
    constructor(public readonly input: { SecretIdList: string[] }) {}
  }
  return {
    SecretsManagerClient: class MockSecretsManagerClient {
      constructor(config: unknown) {
        mockClientConstructor(config);
      }
      send = async (command: unknown) => {
        if (command instanceof MockListSecretsCommand) {
          return mockListSecrets(command.input);
        }
        if (command instanceof MockBatchGetSecretValueCommand) {
          const { SecretIdList } = command.input;
          mockBatch(SecretIdList);
          const SecretValues: Array<{ Name: string; SecretString?: string; SecretBinary?: Buffer }> = [];
          const Errors: Array<{ SecretId: string; ErrorCode: string }> = [];
          for (const id of SecretIdList) {
            if (mockMissingSecrets.has(id)) {
              Errors.push({ SecretId: id, ErrorCode: 'ResourceNotFoundException' });
            } else {
              const value = mockSecretValues.get(id);
              if (value) {
                SecretValues.push({ Name: id, ...value });
              } else {
                Errors.push({ SecretId: id, ErrorCode: 'AccessDeniedException' });
              }
            }
          }
          return { SecretValues, Errors };
        }
        const { SecretId } = (command as MockGetSecretValueCommand).input;
        mockGet(SecretId);
        if (mockMissingSecrets.has(SecretId)) {
          throw Object.assign(new Error('not found'), { name: 'ResourceNotFoundException' });
        }
        const value = mockSecretValues.get(SecretId);
        if (!value) {
          throw Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
        }
        return value;
      };
    },
    ListSecretsCommand: MockListSecretsCommand,
    GetSecretValueCommand: MockGetSecretValueCommand,
    BatchGetSecretValueCommand: MockBatchGetSecretValueCommand,
  };
});

// Import the source after the mock is registered.
import { AppConfigSourceAwsSecrets } from '../../src/sources/app.config.source.aws.secrets.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockSecretValues.clear();
  mockMissingSecrets.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AppConfigSourceAwsSecrets', () => {
  describe('constructor', () => {
    it('should construct the client with an empty config when no region is given', () => {
      new AppConfigSourceAwsSecrets();
      expect(mockClientConstructor).toHaveBeenCalledWith({});
    });

    it('should construct the client with the provided region', () => {
      new AppConfigSourceAwsSecrets({ region: 'us-east-1' });
      expect(mockClientConstructor).toHaveBeenCalledWith({ region: 'us-east-1' });
    });
  });

  describe('load() with an explicit ids list', () => {
    it('should assemble the secrets into one object keyed by name, JSON-parsing values', async () => {
      mockSecretValues.set('database', { SecretString: '{"host":"db"}' });
      mockSecretValues.set('port', { SecretString: '3000' });
      const source = new AppConfigSourceAwsSecrets({ ids: ['database', 'port'] });

      const config = await source.load();

      expect(config).toEqual({ database: { host: 'db' }, port: 3000 });
    });

    it('should fall back to the raw string for non-JSON values', async () => {
      mockSecretValues.set('apiKey', { SecretString: 'sk-abc123' });
      const source = new AppConfigSourceAwsSecrets({ ids: ['apiKey'] });

      const config = await source.load();

      expect(config).toEqual({ apiKey: 'sk-abc123' });
    });

    it('should decode binary secrets to UTF-8', async () => {
      mockSecretValues.set('blob', { SecretBinary: Buffer.from('{"port":8080}', 'utf-8') });
      const source = new AppConfigSourceAwsSecrets({ ids: ['blob'] });

      const config = await source.load();

      expect(config).toEqual({ blob: { port: 8080 } });
    });

    it('should throw when a secret returns neither SecretString nor SecretBinary', async () => {
      mockSecretValues.set('empty', {}); // present, but no payload
      const source = new AppConfigSourceAwsSecrets({ ids: ['empty'] });

      await expect(source.load()).rejects.toThrow(/returned no value/);
    });

    it('should strip a prefix from names before keying', async () => {
      mockSecretValues.set('app/prod/database', { SecretString: '{"host":"db"}' });
      const source = new AppConfigSourceAwsSecrets({ ids: ['app/prod/database'], stripPrefix: 'app/prod/' });

      const config = await source.load();

      expect(config).toEqual({ database: { host: 'db' } });
    });

    it('should nest keys on the configured separator', async () => {
      mockSecretValues.set('app/database/host', { SecretString: 'db' });
      mockSecretValues.set('app/database/port', { SecretString: '5432' });
      mockSecretValues.set('app/port', { SecretString: '3000' });
      const source = new AppConfigSourceAwsSecrets({
        ids: ['app/database/host', 'app/database/port', 'app/port'],
        stripPrefix: 'app/',
        nameSeparator: '/',
      });

      const config = await source.load();

      expect(config).toEqual({ database: { host: 'db', port: 5432 }, port: 3000 });
    });
  });

  describe('load() with discovery', () => {
    it('should list secrets (following pagination) and load each one', async () => {
      mockListSecrets
        .mockResolvedValueOnce({ SecretList: [{ Name: 'app/a' }], NextToken: 'next' })
        .mockResolvedValueOnce({ SecretList: [{ Name: 'app/b' }] });
      mockSecretValues.set('app/a', { SecretString: '1' });
      mockSecretValues.set('app/b', { SecretString: '2' });
      const source = new AppConfigSourceAwsSecrets({ filters: [{ Key: 'name', Values: ['app/'] }], stripPrefix: 'app/' });

      const config = await source.load();

      expect(config).toEqual({ a: 1, b: 2 });
      expect(mockListSecrets).toHaveBeenCalledTimes(2);
      expect(mockListSecrets.mock.calls[0]![0]).toEqual({ Filters: [{ Key: 'name', Values: ['app/'] }], NextToken: undefined });
      expect(mockListSecrets.mock.calls[1]![0].NextToken).toBe('next');
    });

    it('should return an empty object when discovery finds no secrets', async () => {
      mockListSecrets.mockResolvedValue({ SecretList: [] });
      const source = new AppConfigSourceAwsSecrets();

      expect(await source.load()).toEqual({});
    });

    it('should wrap a ListSecrets failure', async () => {
      mockListSecrets.mockRejectedValue(new Error('boom'));
      const source = new AppConfigSourceAwsSecrets();

      await expect(source.load()).rejects.toThrow(/failed to list secrets/);
    });
  });

  describe('bulk fetch (BatchGetSecretValue)', () => {
    it('batches in chunks of 20', async () => {
      const ids = Array.from({ length: 45 }, (_, i) => `s${i}`);
      for (const id of ids) mockSecretValues.set(id, { SecretString: `"${id}"` });
      const source = new AppConfigSourceAwsSecrets({ ids: ids });

      const config = await source.load();

      expect(mockBatch).toHaveBeenCalledTimes(3); // 20 + 20 + 5
      expect(mockGet).not.toHaveBeenCalled(); // never falls back to per-secret GetSecretValue
      expect(config.s0).toBe('s0');
      expect(config.s44).toBe('s44');
    });

    it('loads all secrets correctly under a concurrency cap', async () => {
      const ids = Array.from({ length: 45 }, (_, i) => `s${i}`);
      for (const id of ids) mockSecretValues.set(id, { SecretString: `"${id}"` });
      const source = new AppConfigSourceAwsSecrets({ ids: ids, concurrency: 2 });

      const config = await source.load();

      expect(mockBatch).toHaveBeenCalledTimes(3);
      expect(Object.keys(config)).toHaveLength(45);
    });
  });

  describe('get() caching', () => {
    it('serves a loaded secret from the cache without re-fetching', async () => {
      mockSecretValues.set('a', { SecretString: '1' });
      const source = new AppConfigSourceAwsSecrets({ ids: ['a'] });

      await source.load();
      expect(mockBatch).toHaveBeenCalledTimes(1); // bulk-loaded via BatchGetSecretValue

      expect(await source.get('a')).toBe(1);
      expect(mockGet).not.toHaveBeenCalled(); // served from cache — no GetSecretValue
    });

    it('fetches directly on get() for a secret outside the loaded set', async () => {
      mockSecretValues.set('a', { SecretString: '1' });
      mockSecretValues.set('b', { SecretString: '2' });
      const source = new AppConfigSourceAwsSecrets({ ids: ['a'] });

      await source.load();
      expect(await source.get('b')).toBe(2);
      expect(mockGet).toHaveBeenCalledTimes(1); // 'b' wasn't loaded → one GetSecretValue
    });

    it('always fetches fresh on get() when never loaded (no cache, rotation-safe)', async () => {
      mockSecretValues.set('a', { SecretString: '1' });
      const source = new AppConfigSourceAwsSecrets({ ids: ['a'] });

      await source.get('a');
      await source.get('a');
      expect(mockGet).toHaveBeenCalledTimes(2); // cache only populated by load()
    });
  });

  describe('graceful degradation', () => {
    it('should skip a missing secret when ignoreMissing is set', async () => {
      mockSecretValues.set('present', { SecretString: 'yes' });
      mockMissingSecrets.add('gone');
      const source = new AppConfigSourceAwsSecrets({ ids: ['present', 'gone'], ignoreMissing: true });

      const config = await source.load();

      expect(config).toEqual({ present: 'yes' });
    });

    it('should throw for a missing secret by default', async () => {
      mockMissingSecrets.add('gone');
      const source = new AppConfigSourceAwsSecrets({ ids: ['gone'] });

      await expect(source.load()).rejects.toThrow(/failed to load secret/);
    });

    it('should throw on non-missing errors even when ignoreMissing is set', async () => {
      // 'denied' is neither present in mockSecretValues nor in mockMissingSecrets → AccessDeniedException.
      const source = new AppConfigSourceAwsSecrets({ ids: ['denied'], ignoreMissing: true });

      await expect(source.load()).rejects.toThrow(/failed to load secret/);
    });
  });
});
