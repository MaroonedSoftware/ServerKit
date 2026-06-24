import { describe, it, expect, vi } from 'vitest';
import { Injectable, InjectKitRegistry } from 'injectkit';
import type { Logger } from '@maroonedsoftware/logger';
import { AppConfig } from '../../src/app.config.js';
import { AppConfigBuilder } from '../../src/app.config.builder.js';
import { AppConfigModule } from '../../src/options/app.config.module.js';
import { AppConfigSection } from '../../src/options/app.config.section.js';

interface WidgetConfig {
  name: string;
}

interface RootConfig {
  widget: WidgetConfig;
}

// One token per section, declared exactly as a consumer would (mirrors `SlackConfig`).
@Injectable()
abstract class WidgetOptions extends AppConfigSection<WidgetConfig> {}

function stubLogger(): Logger {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } as unknown as Logger;
}

/** Drains pending microtasks so async `onChange` callbacks have run. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

async function setup(initial: RootConfig) {
  let behavior: () => Promise<Record<string, unknown>> = () => Promise.resolve(initial);
  const builder = new AppConfigBuilder().addSource({ load: () => behavior(), watch: () => () => {} });
  const logger = stubLogger();
  const module = await AppConfigModule.create<RootConfig>(builder, logger);
  return {
    module,
    logger,
    set(next: RootConfig) {
      behavior = () => Promise.resolve(next);
    },
  };
}

describe('AppConfigModule', () => {
  it('configure() chains and returns the module', async () => {
    const { module } = await setup({ widget: { name: 'a' } });
    expect(module.configure('widget', WidgetOptions)).toBe(module);
  });

  it('registers the AppConfig token as a live view that reflects reloads', async () => {
    const { module, set } = await setup({ widget: { name: 'a' } });
    const registry = new InjectKitRegistry();
    module.register(registry);
    const container = registry.build();

    const config = container.get(AppConfig);
    expect(config.getAs<WidgetConfig>('widget')).toEqual({ name: 'a' });

    set({ widget: { name: 'b' } });
    await module.reload();

    expect(config.getAs<WidgetConfig>('widget')).toEqual({ name: 'b' });
  });

  describe('section.value (scope snapshot)', () => {
    it('is stable within a scope and picks up the latest in a new scope after reload', async () => {
      const { module, set } = await setup({ widget: { name: 'a' } });
      const registry = new InjectKitRegistry();
      module.configure('widget', WidgetOptions).register(registry);
      const container = registry.build();

      const scope1 = container.createScopedContainer();
      const first = scope1.get(WidgetOptions);
      expect(first.value).toEqual({ name: 'a' });
      // Same instance within the scope.
      expect(scope1.get(WidgetOptions)).toBe(first);

      set({ widget: { name: 'b' } });
      await module.reload();

      // The already-resolved scope keeps its frozen snapshot...
      expect(first.value).toEqual({ name: 'a' });
      // ...while a fresh scope sees the latest.
      const scope2 = container.createScopedContainer();
      expect(scope2.get(WidgetOptions).value).toEqual({ name: 'b' });
    });
  });

  describe('section.current / onChange (live)', () => {
    it('keeps current live after reload on an already-resolved instance', async () => {
      const { module, set } = await setup({ widget: { name: 'a' } });
      const registry = new InjectKitRegistry();
      module.configure('widget', WidgetOptions).register(registry);
      const container = registry.build();

      const section = container.createScopedContainer().get(WidgetOptions);
      expect(section.current).toEqual({ name: 'a' });

      set({ widget: { name: 'b' } });
      await module.reload();

      // value stays frozen, current tracks the latest.
      expect(section.value).toEqual({ name: 'a' });
      expect(section.current).toEqual({ name: 'b' });
    });

    it('fires onChange listeners after a reload that changes the value', async () => {
      const { module, set } = await setup({ widget: { name: 'a' } });
      const registry = new InjectKitRegistry();
      module.configure('widget', WidgetOptions).register(registry);
      const container = registry.build();

      const section = container.createScopedContainer().get(WidgetOptions);
      const listener = vi.fn();
      section.onChange(listener);

      set({ widget: { name: 'b' } });
      await module.reload();

      await flush();
      expect(listener).toHaveBeenCalledWith({ name: 'b' });
    });

    it('skips onChange when a reload leaves the section structurally unchanged', async () => {
      const { module, set } = await setup({ widget: { name: 'a' } });
      const registry = new InjectKitRegistry();
      module.configure('widget', WidgetOptions).register(registry);
      const container = registry.build();

      const section = container.createScopedContainer().get(WidgetOptions);
      const listener = vi.fn();
      section.onChange(listener);

      set({ widget: { name: 'a' } }); // same value, new object
      await module.reload();

      await flush();
      expect(listener).not.toHaveBeenCalled();
    });

    it('returns a working unsubscribe from onChange', async () => {
      const { module, set } = await setup({ widget: { name: 'a' } });
      const registry = new InjectKitRegistry();
      module.configure('widget', WidgetOptions).register(registry);
      const container = registry.build();

      const section = container.createScopedContainer().get(WidgetOptions);
      const listener = vi.fn();
      const off = section.onChange(listener);
      off();

      set({ widget: { name: 'b' } });
      await module.reload();

      await flush();
      expect(listener).not.toHaveBeenCalled();
    });

    it('reports a throwing listener via logger.error without blocking other listeners', async () => {
      const { module, set, logger } = await setup({ widget: { name: 'a' } });
      const registry = new InjectKitRegistry();
      module.configure('widget', WidgetOptions).register(registry);
      const container = registry.build();

      const section = container.createScopedContainer().get(WidgetOptions);
      const good = vi.fn();
      section.onChange(() => {
        throw new Error('listener boom');
      });
      section.onChange(good);

      set({ widget: { name: 'b' } });
      await module.reload();

      await flush();
      expect(good).toHaveBeenCalledWith({ name: 'b' });
      expect(logger.error).toHaveBeenCalled();
    });

    it('reports a rejecting async listener via logger.error', async () => {
      const { module, set, logger } = await setup({ widget: { name: 'a' } });
      const registry = new InjectKitRegistry();
      module.configure('widget', WidgetOptions).register(registry);
      const container = registry.build();

      const section = container.createScopedContainer().get(WidgetOptions);
      section.onChange(() => Promise.reject(new Error('async boom')));

      set({ widget: { name: 'b' } });
      await module.reload();

      await flush();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('root-resolved section (IOptions behavior)', () => {
    it('exposes the boot value via .value and keeps it frozen, while .current stays live', async () => {
      const { module, set } = await setup({ widget: { name: 'a' } });
      const registry = new InjectKitRegistry();
      module.configure('widget', WidgetOptions).register(registry);
      const container = registry.build();

      // Resolved from the root container: behaves like IOptions<T>.
      const section = container.get(WidgetOptions);
      expect(section.value).toEqual({ name: 'a' });

      set({ widget: { name: 'b' } });
      await module.reload();

      expect(section.value).toEqual({ name: 'a' });
      expect(section.current).toEqual({ name: 'b' });
    });
  });
});
