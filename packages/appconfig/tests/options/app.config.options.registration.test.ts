import { describe, it, expect } from 'vitest';
import { InjectKitRegistry } from 'injectkit';
import { AppConfigBuilder } from '../../src/app.config.builder.js';
import { AppConfigStore } from '../../src/options/app.config.store.js';
import { registerLiveAppConfig } from '../../src/options/app.config.options.registration.js';
import { AppConfig } from '../../src/app.config.js';

interface WidgetConfig {
  name: string;
}

interface RootConfig {
  widget: WidgetConfig;
}

async function setup(initial: RootConfig) {
  let behavior: () => Promise<Record<string, unknown>> = () => Promise.resolve(initial);
  const builder = new AppConfigBuilder().addSource({ load: () => behavior(), watch: () => () => {} });
  const store = await builder.buildStore<RootConfig>();
  const registry = new InjectKitRegistry();
  return {
    store,
    registry,
    set(next: RootConfig) {
      behavior = () => Promise.resolve(next);
    },
  };
}

describe('registerLiveAppConfig', () => {
  it('registers the AppConfig token as a live view that reflects reloads', async () => {
    const { store, registry, set } = await setup({ widget: { name: 'a' } });
    registerLiveAppConfig(registry, store);
    const container = registry.build();

    const config = container.get(AppConfig);
    expect(config.getAs<WidgetConfig>('widget')).toEqual({ name: 'a' });

    set({ widget: { name: 'b' } });
    await store.reload();

    // Same injected instance observes the reload.
    expect(config.getAs<WidgetConfig>('widget')).toEqual({ name: 'b' });
  });
});
