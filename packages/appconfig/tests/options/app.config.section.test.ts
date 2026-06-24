import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import { AppConfigBuilder } from '../../src/app.config.builder.js';
import { AppConfigStore } from '../../src/options/app.config.store.js';
import { AppConfigSectionImpl } from '../../src/options/app.config.section.js';

interface WidgetConfig {
  name: string;
}

interface RootConfig {
  widget: WidgetConfig;
}

function stubLogger(): Logger {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } as unknown as Logger;
}

/** Drains pending microtasks so async `onChange` callbacks have run. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Builds a real store backed by a single source whose `load` behavior can be
 * swapped, so tests can drive what the next `reload()` produces.
 */
async function setup(initial: RootConfig) {
  let behavior: () => Promise<Record<string, unknown>> = () => Promise.resolve(initial);
  const builder = new AppConfigBuilder().addSource({ load: () => behavior(), watch: () => () => {} });
  const store = (await builder.buildStore()) as AppConfigStore<RootConfig>;
  return {
    store,
    set(next: RootConfig) {
      behavior = () => Promise.resolve(next);
    },
  };
}

/** Constructs a section impl over the store's current snapshot, as the module does. */
function section(store: AppConfigStore<RootConfig>, logger: Logger) {
  return new AppConfigSectionImpl<RootConfig, 'widget'>(store.current.getAs<WidgetConfig>('widget'), store, 'widget', logger);
}

describe('AppConfigSectionImpl', () => {
  describe('value', () => {
    it('returns the snapshot captured at construction', async () => {
      const { store } = await setup({ widget: { name: 'a' } });
      const sec = section(store, stubLogger());
      expect(sec.value).toEqual({ name: 'a' });
    });

    it('does not change after a store reload', async () => {
      const { store, set } = await setup({ widget: { name: 'a' } });
      const sec = section(store, stubLogger());

      set({ widget: { name: 'b' } });
      await store.reload();

      expect(sec.value).toEqual({ name: 'a' });
    });
  });

  describe('current', () => {
    it('reflects the latest store value after a reload', async () => {
      const { store, set } = await setup({ widget: { name: 'a' } });
      const sec = section(store, stubLogger());
      expect(sec.current).toEqual({ name: 'a' });

      set({ widget: { name: 'b' } });
      await store.reload();

      expect(sec.current).toEqual({ name: 'b' });
    });
  });

  describe('onChange', () => {
    it('fires with the new section value when the store reloads', async () => {
      const { store, set } = await setup({ widget: { name: 'a' } });
      const sec = section(store, stubLogger());
      const listener = vi.fn();
      sec.onChange(listener);

      set({ widget: { name: 'b' } });
      await store.reload();

      await flush();
      expect(listener).toHaveBeenCalledWith({ name: 'b' });
    });

    it('does not fire when a reload leaves the section structurally unchanged', async () => {
      const { store, set } = await setup({ widget: { name: 'a' } });
      const sec = section(store, stubLogger());
      const listener = vi.fn();
      sec.onChange(listener);

      set({ widget: { name: 'a' } }); // same value, fresh object
      await store.reload();

      await flush();
      expect(listener).not.toHaveBeenCalled();
    });

    it('returns an unsubscribe that stops further notifications', async () => {
      const { store, set } = await setup({ widget: { name: 'a' } });
      const sec = section(store, stubLogger());
      const listener = vi.fn();
      const off = sec.onChange(listener);
      off();

      set({ widget: { name: 'b' } });
      await store.reload();

      await flush();
      expect(listener).not.toHaveBeenCalled();
    });

    it('reports a throwing listener via the logger without breaking other listeners', async () => {
      const logger = stubLogger();
      const { store, set } = await setup({ widget: { name: 'a' } });
      const sec = section(store, logger);
      const good = vi.fn();
      sec.onChange(() => {
        throw new Error('listener boom');
      });
      sec.onChange(good);

      set({ widget: { name: 'b' } });
      await store.reload();

      await flush();
      expect(good).toHaveBeenCalledWith({ name: 'b' });
      expect(logger.error).toHaveBeenCalled();
    });

    it('reports a rejecting async listener via the logger', async () => {
      const logger = stubLogger();
      const { store, set } = await setup({ widget: { name: 'a' } });
      const sec = section(store, logger);
      sec.onChange(() => Promise.reject(new Error('async boom')));

      set({ widget: { name: 'b' } });
      await store.reload();

      await flush();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});
