import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

// Capture client interactions so each test can drive connect/query/end.
const mockConnect = vi.fn();
const mockQuery = vi.fn();
const mockEnd = vi.fn();
let lastClientConfig: Record<string, unknown> | undefined;
// Captures the LISTEN/NOTIFY handler so tests can simulate a NOTIFY.
const mockListen: { handler?: () => void } = {};

// Mock the pg Client before importing the source under test. The Pool is supplied by tests as a
// fake (the source only calls pool.query / pool.connect), so it is not mocked here.
vi.mock('pg', () => ({
  Client: class MockClient {
    connect = mockConnect;
    query = mockQuery;
    end = mockEnd;
    on(event: string, cb: () => void) {
      if (event === 'notification') mockListen.handler = cb;
      return this;
    }
    removeAllListeners() {
      mockListen.handler = undefined;
      return this;
    }
    constructor(config: Record<string, unknown>) {
      lastClientConfig = config;
    }
  },
}));

// Import the source after the mock is registered.
import { AppConfigSourcePostgres } from '../../src/sources/app.config.source.postgres.js';
import type { AppConfigResolver } from '../../src/app.config.resolver.js';
import type { ObjectVisitorMeta } from '../../src/object.visitor.js';

/** Resolves `${env:KEY}` references from a supplied map (a stand-in for process.env). */
function envProvider(env: Record<string, string>): AppConfigResolver {
  return {
    canResolve: value => /\$\{env:(.+)\}/.test(value),
    resolve: async (value: string, meta: ObjectVisitorMeta) => {
      const result = value.replace(/\$\{env:(.+?)\}/g, (_, key: string) => env[key] ?? '');
      (meta.owner as Record<string, unknown>)[meta.propertyPath] = result;
    },
  };
}

const connection = {
  host: 'db.example.com',
  port: 6543,
  user: 'app',
  password: 'secret',
  database: 'appdb',
};

/**
 * Builds a fake `pg.Pool` whose `query` is the shared mock and whose `connect` hands back a
 * dedicated client. `release` is tracked so tests can assert the pool is never ended and the
 * listen client is destroyed (not returned) on dispose.
 */
function makeFakePool() {
  const release = vi.fn();
  const end = vi.fn();
  const connectClient = {
    query: mockQuery,
    release,
    on(event: string, cb: () => void) {
      if (event === 'notification') mockListen.handler = cb;
      return this;
    },
    removeAllListeners() {
      mockListen.handler = undefined;
      return this;
    },
  };
  const pool = {
    query: mockQuery,
    connect: vi.fn(async () => connectClient),
    end,
  };
  return { pool, release, end };
}

describe('AppConfigSourcePostgres', () => {
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    lastClientConfig = undefined;
    mockListen.handler = undefined;
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
      const source = new AppConfigSourcePostgres(logger, { connection });
      expect(source).toBeInstanceOf(AppConfigSourcePostgres);
    });

    it('should create an instance with a connection and options', () => {
      const source = new AppConfigSourcePostgres(logger, { connection }, { schema: 'config' });
      expect(source).toBeInstanceOf(AppConfigSourcePostgres);
    });

    it('should create an instance with an injected pool', () => {
      const { pool } = makeFakePool();
      const source = new AppConfigSourcePostgres(logger, { pool } as never);
      expect(source).toBeInstanceOf(AppConfigSourcePostgres);
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
      const source = new AppConfigSourcePostgres(logger, { connection }, { schema: 'config' });

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
      const source = new AppConfigSourcePostgres(logger, { connection }, { schema: 'config' });

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
      const source = new AppConfigSourcePostgres(logger, { connection }, { schema: 'config' });

      const config = await source.load();

      expect(config).toEqual({ keep: 'me' });
    });

    it('should default the schema to public and the table/columns when not provided', async () => {
      const source = new AppConfigSourcePostgres(logger, { connection });

      await source.load();

      expect(mockQuery).toHaveBeenCalledWith('SELECT "key" AS key, "value" AS value FROM "public"."settings"');
    });

    it('should use the provided schema and default table/column names in the query', async () => {
      const source = new AppConfigSourcePostgres(logger, { connection }, { schema: 'config' });

      await source.load();

      expect(mockQuery).toHaveBeenCalledWith('SELECT "key" AS key, "value" AS value FROM "config"."settings"');
    });

    it('should honour custom schema, table, and column names', async () => {
      const source = new AppConfigSourcePostgres(
        logger,
        { connection },
        {
          schema: 'config',
          table: 'app_settings',
          keyColumn: 'name',
          valueColumn: 'val',
        },
      );

      await source.load();

      expect(mockQuery).toHaveBeenCalledWith('SELECT "name" AS key, "val" AS value FROM "config"."app_settings"');
    });

    it('should pass the connection to the client with a connection timeout', async () => {
      const source = new AppConfigSourcePostgres(logger, { connection }, { schema: 'config' });

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

    it('should resolve variable references in the connection before connecting', async () => {
      const source = new AppConfigSourcePostgres(
        logger,
        {
          connection: {
            host: '${env:DB_HOST}',
            port: 6543,
            user: 'app',
            password: '${env:DB_PASSWORD}',
            database: 'appdb',
          },
          resolvers: [envProvider({ DB_HOST: 'db.internal', DB_PASSWORD: 'rotated-secret' })],
        },
        { schema: 'config' },
      );

      await source.load();

      expect(lastClientConfig).toEqual({
        host: 'db.internal',
        port: 6543,
        user: 'app',
        password: 'rotated-secret',
        database: 'appdb',
        connectionTimeoutMillis: 5000,
      });
    });

    it('should not mutate the original options, re-resolving each load (rotated secrets)', async () => {
      const env = { DB_PASSWORD: 'first' };
      const source = new AppConfigSourcePostgres(logger, {
        connection: { host: 'db', port: 5432, user: 'app', password: '${env:DB_PASSWORD}', database: 'appdb' },
        resolvers: [envProvider(env)],
      });

      await source.load();
      expect((lastClientConfig as { password: string }).password).toBe('first');

      // Simulate a rotated secret picked up on the next reload.
      env.DB_PASSWORD = 'second';
      await source.load();
      expect((lastClientConfig as { password: string }).password).toBe('second');
    });

    it('should use the connection verbatim when no resolvers are configured', async () => {
      const source = new AppConfigSourcePostgres(logger, {
        connection: { host: '${env:DB_HOST}', port: 5432, user: 'app', password: 'secret', database: 'appdb' },
      });

      await source.load();

      // No resolvers → no resolution; the literal reference is passed through.
      expect((lastClientConfig as { host: string }).host).toBe('${env:DB_HOST}');
    });

    it('should always close the client, even on query failure', async () => {
      mockQuery.mockRejectedValue(Object.assign(new Error('boom'), { code: 'XXYYZ' }));
      const source = new AppConfigSourcePostgres(logger, { connection }, { schema: 'config' });

      await expect(source.load()).rejects.toThrow('boom');
      expect(mockEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe('load() with an injected pool', () => {
    it('should query through the pool without opening or ending its own client', async () => {
      mockQuery.mockResolvedValue({ rows: [{ key: 'a', value: '1' }] });
      const { pool, end } = makeFakePool();
      const source = new AppConfigSourcePostgres(logger, { pool } as never, { schema: 'config' });

      const config = await source.load();

      expect(config).toEqual({ a: '1' });
      expect(mockQuery).toHaveBeenCalledWith('SELECT "key" AS key, "value" AS value FROM "config"."settings"');
      // Pool mode never opens its own Client, and never ends the borrowed pool.
      expect(mockConnect).not.toHaveBeenCalled();
      expect(mockEnd).not.toHaveBeenCalled();
      expect(end).not.toHaveBeenCalled();
    });

    it('should degrade gracefully on a missing table in pool mode', async () => {
      mockQuery.mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
      const { pool, end } = makeFakePool();
      const source = new AppConfigSourcePostgres(logger, { pool } as never, { schema: 'config' });

      const config = await source.load();

      expect(config).toEqual({});
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(end).not.toHaveBeenCalled();
    });
  });

  describe('graceful degradation', () => {
    it('should warn and return an empty object when the table does not exist (42P01)', async () => {
      mockQuery.mockRejectedValue(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
      const source = new AppConfigSourcePostgres(logger, { connection }, { schema: 'config' });

      const config = await source.load();

      expect(config).toEqual({});
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(mockEnd).toHaveBeenCalledTimes(1);
    });

    it('should warn and return an empty object when the schema does not exist (3F000)', async () => {
      mockQuery.mockRejectedValue(Object.assign(new Error('schema does not exist'), { code: '3F000' }));
      const source = new AppConfigSourcePostgres(logger, { connection }, { schema: 'config' });

      const config = await source.load();

      expect(config).toEqual({});
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('should rethrow errors that are not missing-table/schema', async () => {
      mockQuery.mockRejectedValue(Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }));
      const source = new AppConfigSourcePostgres(logger, { connection }, { schema: 'config' });

      await expect(source.load()).rejects.toThrow('connection refused');
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('get()', () => {
    it('reads a key from the bulk-loaded snapshot (no per-key query) and JSON-parses it', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { key: 'feature.flag', value: '{"on":true}' },
          { key: 'b', value: '2' },
        ],
      });
      const source = new AppConfigSourcePostgres(logger, { connection }, { schema: 'config' });

      await source.load(); // the builder loading it as a source
      expect(await source.get('feature.flag')).toEqual({ on: true });
      expect(await source.get('b')).toBe(2);

      expect(mockQuery).toHaveBeenCalledTimes(1); // only the load() bulk query — get() never queries
    });

    it('throws when get() is called before the source is loaded', async () => {
      const source = new AppConfigSourcePostgres(logger, { connection }, { schema: 'config' });

      await expect(source.get('a')).rejects.toThrow(/requires the source to be loaded/);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('reflects a reload', async () => {
      mockQuery.mockResolvedValue({ rows: [{ key: 'a', value: '1' }] });
      const source = new AppConfigSourcePostgres(logger, { connection }, { schema: 'config' });
      await source.load();
      expect(await source.get('a')).toBe(1);

      mockQuery.mockResolvedValue({ rows: [{ key: 'a', value: '2' }] });
      await source.load();
      expect(await source.get('a')).toBe(2);
    });

    it('throws when the key is absent from the snapshot', async () => {
      mockQuery.mockResolvedValue({ rows: [{ key: 'a', value: '1' }] });
      const source = new AppConfigSourcePostgres(logger, { connection }, { schema: 'config' });
      await source.load();

      await expect(source.get('missing')).rejects.toThrow(/no value for key "missing"/);
    });
  });

  describe('watch()', () => {
    it('should LISTEN on the configured channel and fire onChange on a NOTIFY', async () => {
      const source = new AppConfigSourcePostgres(logger, { connection }, { schema: 'config', notifyChannel: 'appconfig' });
      const onChange = vi.fn();

      const dispose = source.watch(onChange);
      await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledWith('LISTEN "appconfig"'));

      mockListen.handler!(); // simulate NOTIFY appconfig
      expect(onChange).toHaveBeenCalledTimes(1);

      dispose();
      await vi.waitFor(() => expect(mockEnd).toHaveBeenCalled());
    });

    it('should be a no-op (no connection) when no notifyChannel is configured', () => {
      const source = new AppConfigSourcePostgres(logger, { connection }, { schema: 'config' });

      const dispose = source.watch(vi.fn());

      expect(mockConnect).not.toHaveBeenCalled();
      expect(() => dispose()).not.toThrow();
    });

    it('should stop firing after dispose', async () => {
      const source = new AppConfigSourcePostgres(logger, { connection }, { notifyChannel: 'appconfig' });
      const onChange = vi.fn();

      const dispose = source.watch(onChange);
      await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledWith('LISTEN "appconfig"'));
      dispose();

      // The disposer removes the notification handler (polled, since the connect that
      // assigns the client may settle a tick after the LISTEN query fires).
      await vi.waitFor(() => expect(mockListen.handler).toBeUndefined());
    });
  });

  describe('watch() with an injected pool', () => {
    it('should check out a dedicated client, LISTEN, and destroy (not return) it on dispose', async () => {
      const { pool, release, end } = makeFakePool();
      const source = new AppConfigSourcePostgres(logger, { pool } as never, { notifyChannel: 'appconfig' });
      const onChange = vi.fn();

      const dispose = source.watch(onChange);
      await vi.waitFor(() => expect(pool.connect).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledWith('LISTEN "appconfig"'));

      mockListen.handler!(); // simulate NOTIFY appconfig
      expect(onChange).toHaveBeenCalledTimes(1);

      dispose();
      await vi.waitFor(() => expect(release).toHaveBeenCalled());
      // Listen client is destroyed (release(true)) so the LISTEN never leaks back into the pool,
      // and the borrowed pool itself is never ended.
      expect(release).toHaveBeenCalledWith(true);
      expect(end).not.toHaveBeenCalled();
      expect(mockEnd).not.toHaveBeenCalled();
    });

    it('should cancel a connect still in flight when disposed early', async () => {
      const { pool, release } = makeFakePool();
      const source = new AppConfigSourcePostgres(logger, { pool } as never, { notifyChannel: 'appconfig' });

      const dispose = source.watch(vi.fn());
      dispose(); // before the async connect settles

      await vi.waitFor(() => expect(release).toHaveBeenCalledWith(true));
    });
  });
});
