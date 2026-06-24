import { describe, it, expect, vi } from 'vitest';
import { AppConfigBuilder } from '../../src/app.config.builder.js';
import { AppConfigStore } from '../../src/options/app.config.store.js';

/**
 * Builds a store backed by a single source whose `load` behavior can be swapped,
 * so tests can drive what the next `reload()` produces.
 */
function mutableBuilder<T extends Record<string, unknown>>(initial: T) {
  let behavior: () => Promise<Record<string, unknown>> = () => Promise.resolve(initial);
  const builder = new AppConfigBuilder().addSource({ load: () => behavior(), watch: () => () => {} });
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
    const store = await builder.buildStore();
    expect(store.current.get('a')).toBe(1);
  });

  it('swaps current and notifies subscribers on a successful reload', async () => {
    const { builder, set } = mutableBuilder({ a: 1 });
    const store = await builder.buildStore();
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
    const store = await builder.buildStore();
    const listener = vi.fn();
    store.subscribe(listener);

    set(() => Promise.reject(new Error('boom')));
    await expect(store.reload()).rejects.toThrow('boom');

    expect(store.current.get('a')).toBe(1);
    expect(listener).not.toHaveBeenCalled();
  });

  it('toLiveConfig returns a view that reflects reloads', async () => {
    const { builder, set } = mutableBuilder({ a: 1, mode: 'x' });
    const store = await builder.buildStore();
    const live = store.toLiveConfig();

    expect(live.get('a')).toBe(1);
    expect(live.getString('mode')).toBe('x');

    set(() => Promise.resolve({ a: 2, mode: 'y' }));
    await store.reload();

    // Same live instance, new values — no re-resolution needed.
    expect(live.get('a')).toBe(2);
    expect(live.getString('mode')).toBe('y');
  });

  it('stops notifying after unsubscribe', async () => {
    const { builder, set } = mutableBuilder({ a: 1 });
    const store = await builder.buildStore();
    const listener = vi.fn();
    const off = store.subscribe(listener);
    off();

    set(() => Promise.resolve({ a: 2 }));
    await store.reload();

    expect(listener).not.toHaveBeenCalled();
  });
});

/** A source whose `watch` fires on demand, with a controllable value. */
function watchableSource(initial: Record<string, unknown>) {
  let value = initial;
  let trigger: (() => void) | undefined;
  const load = vi.fn(() => Promise.resolve(value));
  const dispose = vi.fn();
  return {
    source: {
      load,
      watch(onChange: () => void) {
        trigger = onChange;
        return dispose;
      },
    },
    load,
    dispose,
    set(next: Record<string, unknown>) {
      value = next;
    },
    signal() {
      trigger?.();
    },
  };
}

describe('AppConfigStore watch capability', () => {
  it('reloads when a watchable source signals a change', async () => {
    const watched = watchableSource({ a: 1 });
    const store = await new AppConfigBuilder().addSource(watched.source).buildStore();
    expect(store.current.get('a')).toBe(1);

    watched.set({ a: 2 });
    watched.signal();

    await vi.waitFor(() => expect(store.current.get('a')).toBe(2));
  });

  it('reloads only the source that signalled', async () => {
    const watched = watchableSource({ a: 1 });
    const staticLoad = vi.fn(() => Promise.resolve({ b: 1 }));
    const store = await new AppConfigBuilder().addSource(watched.source).addSource({ load: staticLoad, watch: () => () => {} }).buildStore();

    expect(staticLoad).toHaveBeenCalledTimes(1); // initial build
    watched.set({ a: 2 });
    watched.signal();

    await vi.waitFor(() => expect(store.current.get('a')).toBe(2));
    expect(store.current.get('b')).toBe(1);
    expect(staticLoad).toHaveBeenCalledTimes(1); // not re-loaded by the other source's signal
  });

  it('stops watching and releases the watcher on dispose', async () => {
    const watched = watchableSource({ a: 1 });
    const store = await new AppConfigBuilder().addSource(watched.source).buildStore();

    store.dispose();

    expect(watched.dispose).toHaveBeenCalledTimes(1);
  });
});
