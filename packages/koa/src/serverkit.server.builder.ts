import { Logger, ConsoleLogger } from '@maroonedsoftware/logger';
import { Container, InjectKitRegistry, Registry, InjectKitContainerNoop } from 'injectkit';
import { ServerKitModule } from './serverkit.module.js';
import Koa from 'koa';
import { Settings } from 'luxon';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { defaultParserMappings, ServerKitParserMapping } from './parsers/serverkit.default.parsers.js';
import { ServerKitBodyParser, ServerKitParserMappings } from './serverkit.bodyparser.js';
import { ServerKitMiddleware } from './serverkit.middleware.js';
import { ServerkitError } from '@maroonedsoftware/errors';
import { serverKitDefaultMiddleware } from './middleware/server/serverkit.default.middlewares.js';

/**
 * Fluent builder that wires an InjectKit-backed Koa server through its full lifecycle:
 * dependency registration, body-parser setup, middleware and route mounting, listening, and
 * graceful shutdown.
 *
 * Typical usage chains {@link setup} → {@link setupMiddleware} → {@link setupRoutes} → {@link start}:
 * ```typescript
 * const server = await new ServerKitServerBuilder()
 *   .setup(config, logger, modules);
 * server.setupMiddleware().setupRoutes(routes);
 * await server.start(3000);
 * ```
 *
 * Construction sets Luxon's default zone to UTC and installs a {@link InjectKitContainerNoop}
 * placeholder; lifecycle methods that need the real container throw until {@link setup} has run.
 */
export class ServerKitServerBuilder {
  private readonly server: Koa;
  private readonly registry: InjectKitRegistry;

  private container: Container = new InjectKitContainerNoop();
  private modules: ServerKitModule[] = [];
  private logger: Logger = new ConsoleLogger();

  constructor() {
    Settings.defaultZone = 'utc';

    this.server = new Koa();
    this.registry = new InjectKitRegistry();
  }

  /**
   * Registers core dependencies, runs each module's `setup` hook, and builds the DI container.
   *
   * Registers the {@link Logger} and {@link AppConfig} instances, wires the body parsers from
   * `parserMappings`, then awaits every module's optional `setup` hook before building the
   * container. Must run before {@link setupMiddleware}, {@link start}, or {@link shutdown}.
   *
   * @param config - Application configuration, registered and passed to each module's `setup` hook.
   * @param logger - Logger registered in the container and used for lifecycle logging.
   * @param modules - Modules whose `setup`/`start`/`shutdown` hooks run across the server lifecycle.
   * @param parserMappings - MIME-subtype-to-parser mappings to register; defaults to {@link defaultParserMappings}.
   * @returns This builder, for chaining.
   */
  public async setup(
    config: AppConfig,
    logger: Logger,
    modules: ServerKitModule[],
    parserMappings: Record<string, ServerKitParserMapping> = defaultParserMappings,
  ) {
    this.registry.register(Logger).useInstance(logger);
    this.registry.register(AppConfig).useInstance(config);

    this.setupParsers(this.registry, parserMappings);
    this.modules = modules;
    this.logger = logger;

    for (const module of this.modules) {
      if (module.setup) {
        this.logger.info(`Setting up ${module.name}`);
        await module.setup(this.registry, config);
      }
    }

    this.container = this.registry.build();

    return this;
  }

  /**
   * Registers the body parser and its per-MIME-subtype parser mappings on the given registry.
   *
   * Binds {@link ServerKitBodyParser} as a singleton, then for each mapping registers the parser
   * class (if not already registered) and its optional options instance. Idempotent per parser and
   * options id, so overlapping mappings do not double-register.
   *
   * @param registry - The InjectKit registry to register parsers on.
   * @param parserMappings - MIME-subtype-to-parser mappings to wire up.
   */
  protected setupParsers(registry: Registry, parserMappings: Record<string, ServerKitParserMapping>) {
    registry.register(ServerKitBodyParser).useClass(ServerKitBodyParser).asSingleton();

    const parserMappingsRegistration = registry.register(ServerKitParserMappings).useMap(ServerKitParserMappings);
    for (const [key, value] of Object.entries(parserMappings)) {
      parserMappingsRegistration.set(key, value.parser);
      if (!registry.isRegistered(value.parser)) {
        registry.register(value.parser).useClass(value.parser).asSingleton();
      }
      if (value.options && !registry.isRegistered(value.options.id)) {
        registry.register(value.options.id).useInstance(value.options.instance);
      }
    }
  }

  /**
   * Mounts the middleware produced by the given factory onto the server.
   *
   * @param middlewares - Factory called with the built container; defaults to {@link serverKitDefaultMiddleware}.
   * @returns This builder, for chaining.
   * @throws {ServerkitError} If called before {@link setup} has built the container.
   */
  public setupMiddleware(middlewares: (container: Container) => ServerKitMiddleware[] = serverKitDefaultMiddleware): this {
    this.assertInitialized();
    for (const middleware of middlewares(this.container)) {
      this.server.use(middleware);
    }
    return this;
  }

  /**
   * Mounts route middleware onto the server, after the middleware stack.
   *
   * @param routes - Route middleware to register in order.
   * @returns This builder, for chaining.
   */
  public setupRoutes(routes: ServerKitMiddleware[]): this {
    for (const route of routes) {
      this.server.use(route);
    }
    return this;
  }

  /**
   * Starts listening on the given port, running each module's `start` hook once bound.
   *
   * Wires server `error`/`warn` listeners, runs every module's optional `start` hook after the
   * socket binds, and registers `SIGINT`/`SIGTERM` handlers that abort the listener (which triggers
   * {@link shutdown} via the socket's `close` event).
   *
   * @param port - TCP port to listen on (`0` selects an ephemeral port).
   * @returns The underlying Node HTTP server instance.
   * @throws {ServerkitError} If called before {@link setup} has built the container.
   */
  public async start(port: number) {
    this.assertInitialized();

    this.server.on('error', (err) => this.onErrorListener(err));
    this.server.on('warn', (err) => this.onWarnListener(err));

    const controller = new AbortController();
    const serverInstance = this.server.listen({ port, signal: controller.signal, captureRejections: true }, async () => {
      for (const module of this.modules) {
        if (module.start) {
          this.logger.info(`Starting ${module.name}`);
          await module.start(this.container);
        }
      }
      this.logger.info(`Server is running on port ${port}`);
    });

    serverInstance.on('close', async () => {
      await this.shutdown();
    });

    process
      .once('SIGINT', () => {
        this.logger.info('SIGINT received');
        controller.abort();
      })
      .once('SIGTERM', () => {
        this.logger.info('SIGTERM received');
        controller.abort();
      });

    return serverInstance;
  }

  /**
   * Runs each module's `shutdown` hook in order, then terminates the process.
   *
   * Invoked automatically when the server socket closes; can also be called directly. Calls
   * `process.exit()` once all hooks complete.
   *
   * @throws {ServerkitError} If called before {@link setup} has built the container.
   */
  public async shutdown() {
    this.assertInitialized();
    this.logger.info('Server closing');
    for (const module of this.modules) {
      if (module.shutdown) {
        this.logger.info(`Shutting down ${module.name}`);
        await module.shutdown(this.container);
      }
    }

    this.logger.info('Server closed');

    process.exit();
  }

  /**
   * Guards lifecycle methods against use before {@link setup} has replaced the
   * placeholder {@link InjectKitContainerNoop} with the real built container.
   *
   * @throws {ServerkitError} If the container has not been initialized.
   */
  private assertInitialized(): void {
    if (this.container instanceof InjectKitContainerNoop) {
      throw new ServerkitError('Container not initialized');
    }
  }

  private onErrorListener(err: unknown) {
    this.logger.error(err);
  }

  private onWarnListener(err: unknown) {
    this.logger.warn(err);
  }
}
