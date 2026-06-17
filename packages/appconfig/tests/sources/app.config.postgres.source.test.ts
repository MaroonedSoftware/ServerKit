import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

// Capture client interactions so each test can drive connect/query/end.
const mockConnect = vi.fn();
const mockQuery = vi.fn();
const mockEnd = vi.fn();
let lastClientConfig: Record<string, unknown> | undefined;

// Mock the pg Client before importing the source under test.
vi.mock('pg', () => ({
  Client: class MockClient {
    connect = mockConnect;
    query = mockQuery;
    end = mockEnd;
    constructor(config: Record<string, unknown>) {
      lastClientConfig = config;
    }
  },
}));

// Import the source after the mock is registered.
import { AppConfigPostgresSource } from '../../src/sources/app.config.postgres.source.js';

const connection = {
  host: 'db.example.com',
  port: 6543,
  user: 'app',
  password: 'secret',
  database: 'appdb',
};

describe('AppConfigPostgresSource', () => {
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    lastClientConfig = undefined;
    mockConnect.mockResolvedValue(undefined);
    mockEnd.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rows: [] });

    logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create an instance with just a connection', () => {
      const source = new AppConfigPostgresSource(logger, { connection });
      expect(source).toBeInstanceOf(AppConfigPostgresSource);
    });

    it('should create an instance with connection and schema', () => {
      const source = new AppConfigPostgresSource(logger, { connection, schema: 'config' });
      expect(source).toBeInstanceOf(AppConfigPostgresSource);
    });
  });

  describe('load()', () => {
    it('should return rows as a flat record', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { key: 'port', value: '3000' },
          { key: 'name', value: 'serverkit' },
        ],
      });
      const source = new AppConfigPostgresSource(logger, { connection, schema: 'config' });

      const config = await source.load();

      expect(config).toEqual({ port: '3000', name: 'serverkit' });
      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockEnd).toHaveBeenCalledTimes(1);
    });

    it('should skip rows with null values', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { key: 'present', value: 'yes' },
          { key: 'missing', value: null },
        ],
      });
      const source = new AppConfigPostgresSource(logger, { connection, schema: 'config' });

      const config = await source.load();

      expect(config).toEqual({ present: 'yes' });
    });

    it('should skip rows with empty keys', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { key: '', value: 'orphan' },
          { key: 'keep', value: 'me' },
        ],
      });
      const source = new AppConfigPostgresSource(logger, { connection, schema: 'config' });

      const config = await source.load();

      expect(config).toEqual({ keep: 'me' });
    });

    it('should default the schema to public and the table/columns when not provided', async () => {
      const source = new AppConfigPostgresSource(logger, { connection });

      await source.load();

      expect(mockQuery).toHaveBeenCalledWith('SELECT "key" AS key, "value" AS value FROM "public"."settings"');
    });

    it('should use the provided schema and default table/column names in the query', async () => {
      const source = new AppConfigPostgresSource(logger, { connection, schema: 'config' });

      await source.load();

      expect(mockQuery).toHaveBeenCalledWith('SELECT "key" AS key, "value" AS value FROM "config"."settings"');
    });

    it('should honour custom schema, table, and column names', async () => {
      const source = new AppConfigPostgresSource(logger, {
        connection,
        schema: 'config',
        table: 'app_settings',
        keyColumn: 'name',
        valueColumn: 'val',
      });

      await source.load();

      expect(mockQuery).toHaveBeenCalledWith('SELECT "name" AS key, "val" AS value FROM "config"."app_settings"');
    });

    it('should pass the connection to the client with a connection timeout', async () => {
      const source = new AppConfigPostgresSource(logger, { connection, schema: 'config' });

      await source.load();

      expect(lastClientConfig).toEqual({
        host: 'db.example.com',
        port: 6543,
        user: 'app',
        password: 'secret',
        database: 'appdb',
        connectionTimeoutMillis: 5000,
      });
    });

    it('should always close the client, even on query failure', async () => {
      mockQuery.mockRejectedValue(Object.assign(new Error('boom'), { code: 'XXYYZ' }));
      const source = new AppConfigPostgresSource(logger, { connection, schema: 'config' });

      await expect(source.load()).rejects.toThrow('boom');
      expect(mockEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe('graceful degradation', () => {
    it('should warn and return an empty object when the table does not exist (42P01)', async () => {
      mockQuery.mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
      const source = new AppConfigPostgresSource(logger, { connection, schema: 'config' });

      const config = await source.load();

      expect(config).toEqual({});
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(mockEnd).toHaveBeenCalledTimes(1);
    });

    it('should warn and return an empty object when the schema does not exist (3F000)', async () => {
      mockQuery.mockRejectedValue(Object.assign(new Error('schema does not exist'), { code: '3F000' }));
      const source = new AppConfigPostgresSource(logger, { connection, schema: 'config' });

      const config = await source.load();

      expect(config).toEqual({});
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('should rethrow errors that are not missing-table/schema', async () => {
      mockQuery.mockRejectedValue(Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }));
      const source = new AppConfigPostgresSource(logger, { connection, schema: 'config' });

      await expect(source.load()).rejects.toThrow('connection refused');
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
