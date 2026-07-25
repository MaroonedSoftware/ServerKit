import { Registry, Container } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';

/**
 * Defines the lifecycle hooks for a ServerKit module.
 *
 * Modules are discrete units of functionality that can register services,
 * respond to application startup/shutdown, and clean up resources. All
 * lifecycle methods are optional — implement only what your module needs.
 *
 * @template ConfigT - The application config type. Must extend `AppConfig`; defaults to `AppConfig`.
 *
 * @example
 * ```typescript
 * const myModule: ServerKitModule<MyConfig> = {
 *   async setup(registry, config) {
 *     registry.register(MyService, new MyService(config.myService));
 *   },
 *   async start(container) {
 *     await container.resolve(MyService).subscribe();
 *   },
 *   async ready(container, signal) {
 *     await container.resolve(MyService).warmCache(signal);
 *   },
 *   async shutdown(container) {
 *     await container.resolve(MyService).close();
 *   },
 * };
 * ```
 */
export interface ServerKitModule<ConfigT extends AppConfig = AppConfig> {
  /**
   * The name of the module.
   */
  name?: string;
  /**
   * Called during application initialization to register services and
   * bindings into the DI registry before the container is built.
   *
   * @param registry - The InjectKit registry used to register services.
   * @param config - The resolved application configuration.
   */
  setup?: (registry: Registry, config: ConfigT) => Promise<void>;

  /**
   * Called during application shutdown to release resources held by
   * services in the container (e.g. close DB connections, flush buffers).
   *
   * @param container - The built InjectKit container for resolving services.
   */
  shutdown?: (container: Container) => Promise<void>;

  /**
   * Called once the socket is listening, before the server reports ready.
   * Use this for wiring and subscriptions that must exist before the first
   * request is served (e.g. registering event subscribers, attaching listeners).
   * Hooks run in module registration order and every one is awaited, so anything
   * slow (network calls, cache warms, playback, LLM work) belongs in `ready`
   * instead — work done here delays boot for every module after it.
   *
   * @param container - The built InjectKit container for resolving services.
   * @param signal - Aborts when shutdown begins. A signal is delivered here because a
   * shutdown signal received mid-boot tears the server down while `start` hooks are
   * still running; honour it to bail out rather than wire up a server that is closing.
   */
  start?: (container: Container, signal: AbortSignal) => Promise<void>;

  /**
   * Called after the socket is listening AND every module's `start` hook has run —
   * i.e. after the server reports ready. Use for background work that must not delay
   * boot: pollers, schedulers, cache warms, outbound connections. Hooks run in module
   * registration order; a hook that throws is logged and does not block the rest.
   *
   * @param container - The built InjectKit container for resolving services.
   * @param signal - Aborts when shutdown begins. Cancellation is cooperative: pass it to
   * `fetch`, timers, and long loops so an in-flight hook can unwind instead of being torn
   * down mid-flight. Shutdown waits a bounded period for the hook to unwind before running
   * the `shutdown` hooks, so honouring it keeps start-up and tear-down from overlapping.
   */
  ready?: (container: Container, signal: AbortSignal) => Promise<void>;
}
