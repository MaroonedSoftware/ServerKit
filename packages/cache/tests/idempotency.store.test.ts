import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Duration } from 'luxon';
import { CacheProvider } from '../src/cache.provider.js';
import { CacheIdempotencyStore } from '../src/idempotency.store.js';

/**
 * In-memory {@link CacheProvider} with real set-if-absent (`add`) semantics so the store's
 * claim/release lifecycle is exercised for real. TTLs are ignored (not relevant to the logic
 * under test).
 */
class FakeCacheProvider extends CacheProvider {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async add(key: string, value: string): Promise<boolean> {
    if (this.store.has(key)) return false;
    this.store.set(key, value);
    return true;
  }

  async update(key: string, value: string): Promise<void> {
    if (this.store.has(key)) this.store.set(key, value);
  }

  async delete(key: string): Promise<string | null> {
    return this.store.delete(key) ? key : null;
  }
}

let cache: FakeCacheProvider;
let store: CacheIdempotencyStore;

beforeEach(() => {
  cache = new FakeCacheProvider();
  store = new CacheIdempotencyStore(cache);
});

describe('deduplicate', () => {
  it('runs work and returns processed on first delivery', async () => {
    const work = vi.fn().mockResolvedValue('done');

    const outcome = await store.deduplicate('evt-1', work);

    expect(outcome).toEqual({ status: 'processed', result: 'done' });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('skips work and returns duplicate on a completed key', async () => {
    const work = vi.fn().mockResolvedValue('done');
    await store.deduplicate('evt-1', work);

    const second = vi.fn().mockResolvedValue('again');
    const outcome = await store.deduplicate('evt-1', second);

    expect(outcome).toEqual({ status: 'duplicate' });
    expect(second).not.toHaveBeenCalled();
  });

  it('returns duplicate for a concurrent delivery while the first is still in-flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const slow = vi.fn().mockImplementation(async () => {
      await gate;
      return 'slow';
    });

    const first = store.deduplicate('evt-1', slow);
    // Second delivery arrives before the first resolves — the claim is held.
    const concurrentWork = vi.fn().mockResolvedValue('concurrent');
    const second = await store.deduplicate('evt-1', concurrentWork);

    expect(second).toEqual({ status: 'duplicate' });
    expect(concurrentWork).not.toHaveBeenCalled();

    release();
    await expect(first).resolves.toEqual({ status: 'processed', result: 'slow' });
  });

  it('releases the claim and rethrows when work fails, allowing a later redelivery to retry', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(store.deduplicate('evt-1', failing)).rejects.toThrow('boom');

    // A subsequent redelivery is NOT treated as a duplicate — the claim was released.
    const retry = vi.fn().mockResolvedValue('recovered');
    const outcome = await store.deduplicate('evt-1', retry);

    expect(outcome).toEqual({ status: 'processed', result: 'recovered' });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('dead-letters a poison event after maxAttempts and drops future redeliveries', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('boom'));

    // First two attempts release + rethrow.
    await expect(store.deduplicate('evt-1', failing, { maxAttempts: 3 })).rejects.toThrow('boom');
    await expect(store.deduplicate('evt-1', failing, { maxAttempts: 3 })).rejects.toThrow('boom');
    // Third attempt hits the cap: swallowed and dead-lettered.
    const third = await store.deduplicate('evt-1', failing, { maxAttempts: 3 });
    expect(third).toEqual({ status: 'dropped', attempts: 3 });
    expect(failing).toHaveBeenCalledTimes(3);

    // Any later redelivery is dropped without running work again.
    const later = vi.fn().mockResolvedValue('nope');
    const outcome = await store.deduplicate('evt-1', later);
    expect(outcome).toEqual({ status: 'duplicate' });
    expect(later).not.toHaveBeenCalled();
  });

  it('resets the attempt counter after an eventual success', async () => {
    const flaky = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok');

    await expect(store.deduplicate('evt-1', flaky, { maxAttempts: 5 })).rejects.toThrow('boom');
    const outcome = await store.deduplicate('evt-1', flaky, { maxAttempts: 5 });
    expect(outcome).toEqual({ status: 'processed', result: 'ok' });

    // The attempts counter is cleared, so it does not carry over to an unrelated future failure.
    const attempts = await cache.get('idempotency:evt-1:attempts');
    expect(attempts).toBeNull();
  });

  it('namespaces state keys under idempotency:', async () => {
    await store.deduplicate('slack:event:Ev123', vi.fn().mockResolvedValue(undefined), {
      retentionTtl: Duration.fromObject({ hours: 1 }),
    });

    expect(await cache.get('idempotency:slack:event:Ev123')).toBe('completed');
  });
});
