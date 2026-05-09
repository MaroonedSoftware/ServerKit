import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Redis } from 'ioredis';
import { Duration } from 'luxon';
import { IoRedisCacheProvider } from '../src/ioredis.cache.provider.js';

const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
} as unknown as Redis;

let provider: IoRedisCacheProvider;

beforeEach(() => {
  provider = new IoRedisCacheProvider(mockRedis);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('get', () => {
  it('returns the stored string when the key exists', async () => {
    vi.mocked(mockRedis.get).mockResolvedValue('cached-value');

    const result = await provider.get('my-key');

    expect(result).toBe('cached-value');
    expect(mockRedis.get).toHaveBeenCalledWith('my-key');
  });

  it('returns null when the key does not exist', async () => {
    vi.mocked(mockRedis.get).mockResolvedValue(null);

    const result = await provider.get('missing-key');

    expect(result).toBeNull();
  });
});

describe('set', () => {
  it('stores the value with EX set to the TTL in seconds', async () => {
    vi.mocked(mockRedis.set).mockResolvedValue('OK');

    await provider.set('my-key', 'my-value', Duration.fromObject({ hours: 1 }));

    expect(mockRedis.set).toHaveBeenCalledWith('my-key', 'my-value', 'EX', 3600);
  });

  it('converts sub-hour durations to seconds correctly', async () => {
    vi.mocked(mockRedis.set).mockResolvedValue('OK');

    await provider.set('my-key', 'my-value', Duration.fromObject({ minutes: 30 }));

    expect(mockRedis.set).toHaveBeenCalledWith('my-key', 'my-value', 'EX', 1800);
  });

  it('rounds fractional seconds to the nearest integer for the EX flag', async () => {
    vi.mocked(mockRedis.set).mockResolvedValue('OK');

    await provider.set('my-key', 'my-value', Duration.fromObject({ milliseconds: 1500 }));

    expect(mockRedis.set).toHaveBeenCalledWith('my-key', 'my-value', 'EX', 2);
  });
});

describe('update', () => {
  it('uses EX with the new TTL in seconds when a TTL is provided', async () => {
    vi.mocked(mockRedis.set).mockResolvedValue('OK');

    await provider.update('my-key', 'new-value', Duration.fromObject({ minutes: 15 }));

    expect(mockRedis.set).toHaveBeenCalledWith('my-key', 'new-value', 'EX', 900);
  });

  it('rounds fractional seconds to the nearest integer for the EX flag', async () => {
    vi.mocked(mockRedis.set).mockResolvedValue('OK');

    await provider.update('my-key', 'new-value', Duration.fromObject({ milliseconds: 2400 }));

    expect(mockRedis.set).toHaveBeenCalledWith('my-key', 'new-value', 'EX', 2);
  });

  it('uses KEEPTTL when no TTL is provided', async () => {
    vi.mocked(mockRedis.set).mockResolvedValue('OK');

    await provider.update('my-key', 'new-value');

    expect(mockRedis.set).toHaveBeenCalledWith('my-key', 'new-value', 'KEEPTTL');
  });
});

describe('delete', () => {
  it('returns the key when the entry existed', async () => {
    vi.mocked(mockRedis.del).mockResolvedValue(1);

    const result = await provider.delete('my-key');

    expect(result).toBe('my-key');
    expect(mockRedis.del).toHaveBeenCalledWith('my-key');
  });

  it('returns null when the key did not exist', async () => {
    vi.mocked(mockRedis.del).mockResolvedValue(0);

    const result = await provider.delete('missing-key');

    expect(result).toBeNull();
  });
});
