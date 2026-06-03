import { describe, it, expect, vi } from 'vitest';
import { Injectable, InjectKitRegistry } from 'injectkit';
import type { Logger } from '@maroonedsoftware/logger';
import { AppConfigBuilder } from '../../src/app.config.builder.js';
import { AppConfigStore } from '../../src/options/app.config.store.js';
import { AppConfigOptionsManager } from '../../src/options/app.config.options.manager.js';
import { AppConfigOptions, AppConfigOptionsMonitor, AppConfigOptionsSnapshot } from '../../src/options/app.config.options.js';
import { registerAppConfigOptions } from '../../src/options/app.config.options.registration.js';

interface WidgetConfig {
  name: string;
}

interface RootConfig {
  widget: WidgetConfig;
}

// Per-section token classes, declared exactly as a consumer would (mirrors `SlackConfig`).
@Injectable()
abstract class WidgetOptions extends AppConfigOptions<WidgetConfig> {}
@Injectable()
abstract class WidgetSnapshot extends AppConfigOptionsSnapshot<WidgetConfig> {}
@Injectable()
abstract class WidgetMonitor extends AppConfigOptionsMonitor<WidgetConfig> {}

function stubLogger(): Logger {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } as unknown as Logger;
}

async function setup(initial: RootConfig) {
  let behavior: () => Promise<Record<string, unknown>> = () => Promise.resolve(initial);
  const builder = new AppConfigBuilder().addSource({ load: () => behavior() });
  const store = new AppConfigStore<RootConfig>(builder, await builder.build<RootConfig>());
  const manager = new AppConfigOptionsManager(store, stubLogger());
  const registry = new InjectKitRegistry();
  return {
    store,
    manager,
    registry,
    set(next: RootConfig) {
      behavior = () => Promise.resolve(next);
    },
  };
}

describe('registerAppConfigOptions', () => {
  it('registers the monitor as a resolvable singleton', async () => {
    const { store, manager, registry } = await setup({ widget: { name: 'a' } });
    registerAppConfigOptions(registry, store, manager, 'widget', { monitor: WidgetMonitor });
    const container = registry.build();

    const monitor = container.get(WidgetMonitor);
    expect(monitor.current).toEqual({ name: 'a' });
    expect(container.get(WidgetMonitor)).toBe(monitor);
  });

  it('registers the static options snapshot value', async () => {
    const { store, manager, registry } = await setup({ widget: { name: 'a' } });
    registerAppConfigOptions(registry, store, manager, 'widget', { options: WidgetOptions });
    const container = registry.build();

    expect(container.get(WidgetOptions).value).toEqual({ name: 'a' });
  });

  it('resolves the snapshot per scope: stable within a scope, latest in a new scope after reload', async () => {
    const { store, manager, registry, set } = await setup({ widget: { name: 'a' } });
    registerAppConfigOptions(registry, store, manager, 'widget', { snapshot: WidgetSnapshot });
    const container = registry.build();

    const scope1 = container.createScopedContainer();
    const first = scope1.get(WidgetSnapshot);
    expect(first.value).toEqual({ name: 'a' });
    expect(scope1.get(WidgetSnapshot)).toBe(first);

    set({ widget: { name: 'b' } });
    await store.reload();

    const scope2 = container.createScopedContainer();
    expect(scope2.get(WidgetSnapshot).value).toEqual({ name: 'b' });
  });

  it('keeps the live monitor updating after reload', async () => {
    const { store, manager, registry, set } = await setup({ widget: { name: 'a' } });
    registerAppConfigOptions(registry, store, manager, 'widget', { monitor: WidgetMonitor });
    const container = registry.build();
    const monitor = container.get(WidgetMonitor);

    set({ widget: { name: 'b' } });
    await store.reload();

    expect(monitor.current).toEqual({ name: 'b' });
  });
});
