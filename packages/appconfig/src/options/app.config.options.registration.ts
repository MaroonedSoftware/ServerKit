import { Registry } from 'injectkit';
import { AppConfig } from '../app.config.js';
import { AppConfigStore } from './app.config.store.js';

/**
 * Registers the `AppConfig` DI token as a live view over a reloadable store.
 *
 * The registered instance is {@link AppConfigStore.toLiveConfig}, so every
 * consumer that injects `AppConfig` reads through the store's current snapshot
 * and observes a reload on its next read — the whole-config counterpart to a
 * typed {@link import('./app.config.section.js').AppConfigSection}. Use this when
 * config is accessed as flat ad-hoc keys off the `AppConfig` token rather than
 * as typed sections.
 *
 * {@link import('./app.config.module.js').AppConfigModule.register} already calls
 * this for you; reach for it directly only when you want the live `AppConfig`
 * token without configuring any sections.
 *
 * @template TRoot - The root configuration type held by the store.
 * @param registry - The registry to register into (before `build()`).
 * @param store - The reloadable store whose current config the token reflects.
 *
 * @example
 * ```typescript
 * const store = await builder.buildStore();
 * registerLiveAppConfig(registry, store);
 * // anywhere downstream: container.get(AppConfig).getString('FEATURE_FLAG')
 * // returns the latest value after store.reload().
 * ```
 */
export function registerLiveAppConfig<TRoot>(registry: Registry, store: AppConfigStore<TRoot>): void {
  registry.register(AppConfig).useInstance(store.toLiveConfig() as AppConfig);
}
