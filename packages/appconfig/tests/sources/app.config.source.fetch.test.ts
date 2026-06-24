import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppConfigSourceFetch, type AppConfigSourceFetchOptions } from '../../src/sources/app.config.source.fetch.js';

/**
 * Minimal concrete subclass exercising the abstract base. The "backend" is an in-memory map; a
 * value of `undefined` models a tolerated miss. `fetch`/`discover` are spies so tests can assert
 * how `load`/`get`/`fetchMany` drive them.
 */
class TestFetchSource extends AppConfigSourceFetch {
  fetch = vi.fn(async (id: string): Promise<unknown> => this.store.get(id));
  discover = vi.fn(async (): Promise<string[]> => [...this.store.keys()]);

  constructor(
    private readonly store: Map<string, unknown>,
    options: AppConfigSourceFetchOptions = {},
  ) {
    super(options);
  }
}

describe('AppConfigSourceFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create an instance with no options', () => {
      const source = new TestFetchSource(new Map());
      expect(source).toBeInstanceOf(AppConfigSourceFetch);
    });

    it('should create an instance with options', () => {
      const source = new TestFetchSource(new Map(), { ids: ['a'], stripPrefix: 'app/', nameSeparator: '__', concurrency: 2 });
      expect(source).toBeInstanceOf(AppConfigSourceFetch);
    });
  });

  describe('load()', () => {
    it('should fetch the explicit ids and key each value under its id', async () => {
      const store = new Map<string, unknown>([
        ['port', '3000'],
        ['name', 'serverkit'],
        ['unused', 'x'],
      ]);
      const source = new TestFetchSource(store, { ids: ['port', 'name'] });

      const config = await source.load();

      expect(config).toEqual({ port: '3000', name: 'serverkit' });
      // Explicit ids → discover is never called.
      expect(source.discover).not.toHaveBeenCalled();
      expect(source.fetch).toHaveBeenCalledTimes(2);
      expect(source.fetch).toHaveBeenCalledWith('port');
      expect(source.fetch).toHaveBeenCalledWith('name');
    });

    it('should discover ids when none are configured', async () => {
      const store = new Map<string, unknown>([
        ['a', '1'],
        ['b', '2'],
      ]);
      const source = new TestFetchSource(store);

      const config = await source.load();

      expect(source.discover).toHaveBeenCalledTimes(1);
      expect(config).toEqual({ a: '1', b: '2' });
    });

    it('should skip values that resolve to undefined (tolerated misses)', async () => {
      const store = new Map<string, unknown>([
        ['present', 'yes'],
        ['missing', undefined],
      ]);
      const source = new TestFetchSource(store, { ids: ['present', 'missing'] });

      const config = await source.load();

      expect(config).toEqual({ present: 'yes' });
    });

    it('should strip the configured prefix from ids when deriving keys', async () => {
      const store = new Map<string, unknown>([
        ['app/port', '3000'],
        ['app/name', 'serverkit'],
      ]);
      const source = new TestFetchSource(store, { ids: ['app/port', 'app/name'], stripPrefix: 'app/' });

      const config = await source.load();

      expect(config).toEqual({ port: '3000', name: 'serverkit' });
    });

    it('should leave ids untouched when they do not start with stripPrefix', async () => {
      const store = new Map<string, unknown>([['other/port', '3000']]);
      const source = new TestFetchSource(store, { ids: ['other/port'], stripPrefix: 'app/' });

      const config = await source.load();

      expect(config).toEqual({ 'other/port': '3000' });
    });

    it('should nest keys on nameSeparator when configured', async () => {
      const store = new Map<string, unknown>([
        ['DB__host', 'localhost'],
        ['DB__port', '5432'],
        ['NAME', 'serverkit'],
      ]);
      const source = new TestFetchSource(store, { ids: ['DB__host', 'DB__port', 'NAME'], nameSeparator: '__' });

      const config = await source.load();

      expect(config).toEqual({ DB: { host: 'localhost', port: '5432' }, NAME: 'serverkit' });
    });

    it('should return an empty object when there are no ids', async () => {
      const source = new TestFetchSource(new Map(), { ids: [] });

      const config = await source.load();

      expect(config).toEqual({});
    });

    it('should surface a fetch error', async () => {
      const source = new TestFetchSource(new Map(), { ids: ['boom'] });
      source.fetch.mockRejectedValueOnce(new Error('backend exploded'));

      await expect(source.load()).rejects.toThrow('backend exploded');
    });
  });

  describe('get()', () => {
    it('should serve a value from the load() snapshot without re-fetching', async () => {
      const store = new Map<string, unknown>([
        ['a', '1'],
        ['b', '2'],
      ]);
      const source = new TestFetchSource(store, { ids: ['a', 'b'] });

      await source.load();
      source.fetch.mockClear();

      expect(await source.get('a')).toBe('1');
      expect(await source.get('b')).toBe('2');
      // Both keys came from the cache — no second round trip.
      expect(source.fetch).not.toHaveBeenCalled();
    });

    it('should serve a cached undefined (tolerated miss) from the snapshot', async () => {
      const store = new Map<string, unknown>([['missing', undefined]]);
      const source = new TestFetchSource(store, { ids: ['missing'] });

      await source.load();
      source.fetch.mockClear();

      expect(await source.get('missing')).toBeUndefined();
      // The id was loaded (cache has it, value undefined) → no fetch.
      expect(source.fetch).not.toHaveBeenCalled();
    });

    it('should fetch directly on a cache miss without caching the result', async () => {
      const store = new Map<string, unknown>([['known', 'v']]);
      const source = new TestFetchSource(store, { ids: ['known'] });
      await source.load();
      source.fetch.mockClear();

      store.set('fresh', 'value');
      expect(await source.get('fresh')).toBe('value');
      expect(source.fetch).toHaveBeenCalledWith('fresh');

      // Cache miss is not cached — a second get fetches again.
      store.set('fresh', 'rotated');
      expect(await source.get('fresh')).toBe('rotated');
      expect(source.fetch).toHaveBeenCalledTimes(2);
    });

    it('should fetch fresh when the source was never loaded', async () => {
      const store = new Map<string, unknown>([['a', '1']]);
      const source = new TestFetchSource(store);

      expect(await source.get('a')).toBe('1');
      expect(source.fetch).toHaveBeenCalledWith('a');
      expect(source.discover).not.toHaveBeenCalled();
    });

    it('should reflect a reload (refreshed snapshot)', async () => {
      const store = new Map<string, unknown>([['a', '1']]);
      const source = new TestFetchSource(store, { ids: ['a'] });
      await source.load();
      expect(await source.get('a')).toBe('1');

      store.set('a', '2');
      await source.load();
      source.fetch.mockClear();
      expect(await source.get('a')).toBe('2');
      expect(source.fetch).not.toHaveBeenCalled();
    });
  });

  describe('fetchMany via concurrency', () => {
    it('should bound concurrent fetches by the configured limit', async () => {
      const ids = ['a', 'b', 'c', 'd', 'e'];
      const store = new Map<string, unknown>(ids.map(id => [id, id.toUpperCase()] as const));
      const source = new TestFetchSource(store, { ids, concurrency: 2 });

      let inFlight = 0;
      let maxInFlight = 0;
      source.fetch.mockImplementation(async (id: string) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight--;
        return store.get(id);
      });

      const config = await source.load();

      expect(config).toEqual({ a: 'A', b: 'B', c: 'C', d: 'D', e: 'E' });
      expect(maxInFlight).toBeLessThanOrEqual(2);
      expect(source.fetch).toHaveBeenCalledTimes(5);
    });
  });

  describe('watch()', () => {
    it('should be a no-op that never invokes onChange', () => {
      const source = new TestFetchSource(new Map());
      const onChange = vi.fn();

      const dispose = source.watch(onChange);

      expect(onChange).not.toHaveBeenCalled();
      expect(typeof dispose).toBe('function');
      expect(() => dispose()).not.toThrow();
    });
  });
});
