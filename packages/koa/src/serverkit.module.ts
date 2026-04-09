import { Registry, Container } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';

/**
 * Defines the lifecycle hooks for a ServerKit module.
 *
 * Modules are discrete units of functionality that can register services,
 * respond to application startup/shutdown, and clean up resources. All
 * lifecycle methods are optional — implement only what your module needs.
 *
 * @template ConfigT - The application config type, defaults to `AppConfig`.
 *
 * @example
 * ```typescript
 * const myModule: ServerKitModule<MyConfig> = {
 *   async setup(registry, config) {
 *     registry.register(MyService, new MyService(config.myService));
 *   },
 *   async start(container) {
 *     await container.resolve(MyService).start();
 *   },
 *   async shutdown(container) {
 *     await container.resolve(MyService).close();
 *   },
 * };
 * ```
 */
export interface ServerKitModule<ConfigT = AppConfig> {
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
   * Called after the application is fully initialized and ready to serve
   * requests. Use this to begin background work (e.g. start polling, open
   * socket connections).
   *
   * @param container - The built InjectKit container for resolving services.
   */
  start?: (container: Container) => Promise<void>;
}
