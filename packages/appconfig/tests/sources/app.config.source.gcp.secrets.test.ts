import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the GCP Secret Manager client before importing the source. Closures must be
// `mock`-prefixed — vitest hoists the factory above the file.
const mockAccess = vi.fn();
const mockList = vi.fn();

vi.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: class MockSecretManagerServiceClient {
    accessSecretVersion = mockAccess;
    listSecrets = mockList;
  },
}));

// Import the source after the mock is registered.
import { AppConfigSourceGcpSecrets } from '../../src/sources/app.config.source.gcp.secrets.js';

/** Resolves `accessSecretVersion` against a name→string map, throwing NOT_FOUND for misses. */
function secretMap(values: Record<string, string>, missing: string[] = []): void {
  mockAccess.mockImplementation(async ({ name }: { name: string }) => {
    const id = name.split('/')[3]!; // projects/{p}/secrets/{id}/versions/latest
    if (missing.includes(id)) {
      throw Object.assign(new Error('not found'), { code: 5 });
    }
    if (!(id in values)) {
      throw Object.assign(new Error('denied'), { code: 7 });
    }
    return [{ payload: { data: Buffer.from(values[id]!, 'utf-8') } }];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AppConfigSourceGcpSecrets', () => {
  describe('load() with an explicit ids list', () => {
    it('assembles secrets into one object keyed by id, JSON-parsing values', async () => {
      secretMap({ database: '{"host":"db"}', port: '3000' });
      const source = new AppConfigSourceGcpSecrets('proj', { ids: ['database', 'port'] });

      expect(await source.load()).toEqual({ database: { host: 'db' }, port: 3000 });
    });

    it('strips a prefix and nests on the separator', async () => {
      secretMap({ 'app.database.host': 'db', 'app.database.port': '5432', 'app.port': '3000' });
      const source = new AppConfigSourceGcpSecrets('proj', {
        ids: ['app.database.host', 'app.database.port', 'app.port'],
        stripPrefix: 'app.',
        nameSeparator: '.',
      });

      expect(await source.load()).toEqual({ database: { host: 'db', port: 5432 }, port: 3000 });
    });

    it('accesses the latest version by resource path', async () => {
      secretMap({ key: 'value' });
      const source = new AppConfigSourceGcpSecrets('proj', { ids: ['key'] });

      await source.load();

      expect(mockAccess).toHaveBeenCalledWith({ name: 'projects/proj/secrets/key/versions/latest' });
    });
  });

  describe('load() with discovery', () => {
    it('lists secrets and loads each by its short id', async () => {
      mockList.mockResolvedValue([[{ name: 'projects/proj/secrets/app.a' }, { name: 'projects/proj/secrets/app.b' }]]);
      secretMap({ 'app.a': '1', 'app.b': '2' });
      const source = new AppConfigSourceGcpSecrets('proj', { filter: 'name:app.', stripPrefix: 'app.' });

      expect(await source.load()).toEqual({ a: 1, b: 2 });
      expect(mockList).toHaveBeenCalledWith({ parent: 'projects/proj', filter: 'name:app.' });
    });

    it('wraps a listSecrets failure', async () => {
      mockList.mockRejectedValue(new Error('boom'));
      const source = new AppConfigSourceGcpSecrets('proj');

      await expect(source.load()).rejects.toThrow(/failed to list secrets/);
    });
  });

  describe('get() and graceful degradation', () => {
    it('returns the parsed value for a single secret', async () => {
      secretMap({ token: '{"v":1}' });
      const source = new AppConfigSourceGcpSecrets('proj');

      expect(await source.get('token')).toEqual({ v: 1 });
    });

    it('skips a missing secret when ignoreMissing is set', async () => {
      secretMap({ present: 'yes' }, ['gone']);
      const source = new AppConfigSourceGcpSecrets('proj', { ids: ['present', 'gone'], ignoreMissing: true });

      expect(await source.load()).toEqual({ present: 'yes' });
    });

    it('throws for a missing secret by default', async () => {
      secretMap({}, ['gone']);
      const source = new AppConfigSourceGcpSecrets('proj', { ids: ['gone'] });

      await expect(source.load()).rejects.toThrow(/failed to resolve secret/);
    });

    it('throws when a version carries no payload', async () => {
      mockAccess.mockResolvedValue([{ payload: { data: undefined } }]); // present, but no payload
      const source = new AppConfigSourceGcpSecrets('proj', { ids: ['empty'] });

      await expect(source.load()).rejects.toThrow(/returned no value/);
    });
  });
});
