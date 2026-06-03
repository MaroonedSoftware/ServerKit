import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import { AppConfigBuilder } from '../../src/app.config.builder.js';
import { AppConfigStore } from '../../src/options/app.config.store.js';
import { AppConfigOptionsManager } from '../../src/options/app.config.options.manager.js';

function stubLogger(): Logger {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } as unknown as Logger;
}

function mutableBuilder(initial: Record<string, unknown>) {
  let behavior: () => Promise<Record<string, unknown>> = () => Promise.resolve(initial);
  const builder = new AppConfigBuilder().addSource({ load: () => behavior() });
  return {
    builder,
    set(next: () => Promise<Record<string, unknown>>) {
      behavior = next;
    },
  };
}

describe('AppConfigOptionsManager', () => {
  it('slices the right section for monitor() and options()', async () => {
    const { builder } = mutableBuilder({ slack: { token: 'a' }, db: { host: 'h' } });
    const store = new AppConfigStore(builder, await builder.build());
    const manager = new AppConfigOptionsManager(store, stubLogger());

    expect(manager.monitor('slack').current).toEqual({ token: 'a' });
    expect(manager.options('db').value).toEqual({ host: 'h' });
  });

  it('returns the same monitor instance for a given key', async () => {
    const { builder } = mutableBuilder({ slack: { token: 'a' } });
    const store = new AppConfigStore(builder, await builder.build());
    const manager = new AppConfigOptionsManager(store, stubLogger());

    expect(manager.monitor('slack')).toBe(manager.monitor('slack'));
  });

  it('updates the monitor on reload while a prior options() snapshot stays frozen', async () => {
    const { builder, set } = mutableBuilder({ slack: { token: 'a' } });
    const store = new AppConfigStore(builder, await builder.build());
    const manager = new AppConfigOptionsManager(store, stubLogger());

    const monitor = manager.monitor('slack');
    const snapshot = manager.options('slack');

    set(() => Promise.resolve({ slack: { token: 'b' } }));
    await store.reload();

    expect(monitor.current).toEqual({ token: 'b' });
    expect(snapshot.value).toEqual({ token: 'a' });
  });

  it('only updates monitors that were requested', async () => {
    const { builder, set } = mutableBuilder({ slack: { token: 'a' }, db: { host: 'h' } });
    const store = new AppConfigStore(builder, await builder.build());
    const manager = new AppConfigOptionsManager(store, stubLogger());

    const slack = manager.monitor('slack');

    set(() => Promise.resolve({ slack: { token: 'b' }, db: { host: 'h2' } }));
    await store.reload();

    expect(slack.current).toEqual({ token: 'b' });
    // db was never requested before the reload, so it is created fresh with the latest value
    expect(manager.monitor('db').current).toEqual({ host: 'h2' });
  });
});
