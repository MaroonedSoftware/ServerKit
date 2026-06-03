import { describe, it, expect, vi } from 'vitest';
import { AppConfigBuilder } from '../../src/app.config.builder.js';
import { AppConfigStore } from '../../src/options/app.config.store.js';

/**
 * Builds a store backed by a single source whose `load` behavior can be swapped,
 * so tests can drive what the next `reload()` produces.
 */
function mutableBuilder<T extends Record<string, unknown>>(initial: T) {
  let behavior: () => Promise<Record<string, unknown>> = () => Promise.resolve(initial);
  const builder = new AppConfigBuilder().addSource({ load: () => behavior() });
  return {
    builder,
    set(next: () => Promise<Record<string, unknown>>) {
      behavior = next;
    },
  };
}

describe('AppConfigStore', () => {
  it('serves the initial config', async () => {
    const { builder } = mutableBuilder({ a: 1 });
    const store = new AppConfigStore(builder, await builder.build());
    expect(store.current.get('a')).toBe(1);
  });

  it('swaps current and notifies subscribers on a successful reload', async () => {
    const { builder, set } = mutableBuilder({ a: 1 });
    const store = new AppConfigStore(builder, await builder.build());
    const listener = vi.fn();
    store.subscribe(listener);

    set(() => Promise.resolve({ a: 2 }));
    await store.reload();

    expect(store.current.get('a')).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]![0]!.get('a')).toBe(2);
  });

  it('keeps last-good config and rejects when the rebuild fails', async () => {
    const { builder, set } = mutableBuilder({ a: 1 });
    const store = new AppConfigStore(builder, await builder.build());
    const listener = vi.fn();
    store.subscribe(listener);

    set(() => Promise.reject(new Error('boom')));
    await expect(store.reload()).rejects.toThrow('boom');

    expect(store.current.get('a')).toBe(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying after unsubscribe', async () => {
    const { builder, set } = mutableBuilder({ a: 1 });
    const store = new AppConfigStore(builder, await builder.build());
    const listener = vi.fn();
    const off = store.subscribe(listener);
    off();

    set(() => Promise.resolve({ a: 2 }));
    await store.reload();

    expect(listener).not.toHaveBeenCalled();
  });
});
