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

  it('rounds fractional seconds up for the EX flag', async () => {
    vi.mocked(mockRedis.set).mockResolvedValue('OK');

    await provider.set('my-key', 'my-value', Duration.fromObject({ milliseconds: 1500 }));

    expect(mockRedis.set).toHaveBeenCalledWith('my-key', 'my-value', 'EX', 2);
  });

  it('clamps a sub-second TTL to EX 1 rather than EX 0', async () => {
    vi.mocked(mockRedis.set).mockResolvedValue('OK');

    await provider.set('my-key', 'my-value', Duration.fromObject({ milliseconds: 200 }));

    // Math.round(0.2) would be 0 (which Redis rejects); ceil + min-1 yields 1.
    expect(mockRedis.set).toHaveBeenCalledWith('my-key', 'my-value', 'EX', 1);
  });
});

describe('add', () => {
  it('sets the value with NX and returns true when the key did not exist', async () => {
    vi.mocked(mockRedis.set).mockResolvedValue('OK');

    const result = await provider.add('lock', 'held');

    expect(result).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledWith('lock', 'held', 'NX');
  });

  it('returns false when the key already exists (NX set did not apply)', async () => {
    // Redis returns null for a NX SET that was skipped because the key exists.
    vi.mocked(mockRedis.set).mockResolvedValue(null);

    const result = await provider.add('lock', 'held');

    expect(result).toBe(false);
  });

  it('applies an EX expiry alongside NX when a ttl is given, clamped to at least 1', async () => {
    vi.mocked(mockRedis.set).mockResolvedValue('OK');

    await provider.add('lock', 'held', { ttl: Duration.fromObject({ milliseconds: 200 }) });

    expect(mockRedis.set).toHaveBeenCalledWith('lock', 'held', 'EX', 1, 'NX');
  });

  it('returns true then false across two calls for the same key', async () => {
    vi.mocked(mockRedis.set).mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    expect(await provider.add('lock', 'held')).toBe(true);
    expect(await provider.add('lock', 'held')).toBe(false);
  });
});

describe('update', () => {
  it('uses EX with the new TTL in seconds when a TTL is provided', async () => {
    vi.mocked(mockRedis.set).mockResolvedValue('OK');

    await provider.update('my-key', 'new-value', Duration.fromObject({ minutes: 15 }));

    expect(mockRedis.set).toHaveBeenCalledWith('my-key', 'new-value', 'EX', 900);
  });

  it('rounds fractional seconds up for the EX flag', async () => {
    vi.mocked(mockRedis.set).mockResolvedValue('OK');

    await provider.update('my-key', 'new-value', Duration.fromObject({ milliseconds: 2400 }));

    expect(mockRedis.set).toHaveBeenCalledWith('my-key', 'new-value', 'EX', 3);
  });

  it('uses KEEPTTL with XX when no TTL is provided so an expired key is not resurrected', async () => {
    vi.mocked(mockRedis.set).mockResolvedValue('OK');

    await provider.update('my-key', 'new-value');

    // XX means "only if the key exists" — if it expired, the write is a no-op instead of
    // recreating a key with no expiry.
    expect(mockRedis.set).toHaveBeenCalledWith('my-key', 'new-value', 'KEEPTTL', 'XX');
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
