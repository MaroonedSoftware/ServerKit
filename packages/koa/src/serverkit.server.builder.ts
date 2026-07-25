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
import { ServerKitRouterType } from './serverkit.router.js';
import type { Server } from 'node:http';

/**
 * Default graceful-shutdown grace period, in milliseconds. On SIGINT/SIGTERM the
 * server stops accepting new connections and drains in-flight requests for this
 * long, then force-closes any still-open sockets so `close()` can complete.
 */
export const DEFAULT_SHUTDOWN_GRACE_MS = 10_000;

/** Options for {@link ServerKitServerBuilder.start}. */
export interface ServerKitStartOptions {
  /**
   * Milliseconds to drain in-flight requests before force-closing lingering
   * sockets on SIGINT/SIGTERM. Defaults to {@link DEFAULT_SHUTDOWN_GRACE_MS}.
   * `0` force-closes immediately. Long-lived connections (SSE streams, idle
   * keep-alive sockets) are always closed once the grace period elapses, so
   * shutdown can never hang regardless of this value.
   */
  shutdownGraceMs?: number;
}

/**
 * Fluent builder that wires an InjectKit-backed Koa server through its full lifecycle:
 * dependency registration, body-parser setup, middleware and route mounting, listening, and
 * graceful shutdown.
 *
 * Typical usage runs {@link setup} (which returns the built container), then chains
 * {@link setupMiddleware} → {@link setupRoutes}, then {@link start}:
 * ```typescript
 * const builder = new ServerKitServerBuilder();
 * await builder.setup(config, logger, modules);
 * builder.setupMiddleware().setupRoutes([router]);
 * await builder.start(3000);
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

  /**
   * Aborted the moment the server starts winding down — on `SIGINT`/`SIGTERM`, or when
   * {@link shutdown} is called directly. Doubles as the "are we stopping?" flag and as the
   * cooperative-cancellation signal handed to every `start` and `ready` hook and to anything
   * holding a socket open; see {@link lifecycleSignal}.
   */
  private readonly lifecycle = new AbortController();

  /** True once {@link shutdown} has started its pass over the hooks, making it idempotent. */
  private shuttingDown = false;

  /** True while {@link runReady} is mid-flight, so {@link shutdown} knows whether to wait for it. */
  private readyRunning = false;

  /** Grace period for both the socket drain and the ready-phase wait; set by {@link start}. */
  private shutdownGraceMs = DEFAULT_SHUTDOWN_GRACE_MS;

  // Declared before `readyPromise` on purpose: the executor below runs synchronously
  // during field initialization, so this is assigned by the time the promise exists.
  private resolveReady!: () => void;
  private readonly readyPromise = new Promise<void>(resolve => {
    this.resolveReady = resolve;
  });

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
   * @param modules - Modules whose `setup`/`start`/`ready`/`shutdown` hooks run across the server lifecycle.
   * @param parserMappings - MIME-subtype-to-parser mappings to register; defaults to {@link defaultParserMappings}.
   * @returns The built container.
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
    return this.container;
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
   * Mounts routers onto the server, after the middleware stack.
   *
   * @param routes - Routers whose `routes()` and `allowedMethods()` middleware are mounted in order.
   * @returns This builder, for chaining.
   */
  public setupRoutes(routes: ServerKitRouterType[]): this {
    for (const route of routes) {
      this.server.use(route.routes()).use(route.allowedMethods());
    }
    return this;
  }

  /**
   * Starts listening on the given port, running each module's `start` hook once bound.
   *
   * Wires server `error`/`warn` listeners, runs every module's optional `start` hook after the
   * socket binds, and registers `SIGINT`/`SIGTERM` handlers that gracefully close the server
   * (which triggers {@link shutdown} via the socket's `close` event).
   *
   * Once the server reports ready, the `ready` phase is kicked off without being awaited, so
   * background work never delays boot or this method's return; see {@link runReady} and
   * {@link whenReady}.
   *
   * @param port - TCP port to listen on (`0` selects an ephemeral port).
   * @param options - Shutdown tuning; see {@link ServerKitStartOptions}.
   * @returns The underlying Node HTTP server instance.
   * @throws {ServerkitError} If called before {@link setup} has built the container.
   */
  public async start(port: number, options: ServerKitStartOptions = {}) {
    this.assertInitialized();

    this.shutdownGraceMs = options.shutdownGraceMs ?? DEFAULT_SHUTDOWN_GRACE_MS;

    this.server.on('error', err => this.onErrorListener(err));
    this.server.on('warn', err => this.onWarnListener(err));

    const controller = new AbortController();
    const serverInstance = this.server.listen({ port, signal: controller.signal, captureRejections: true }, async () => {
      for (const module of this.modules) {
        if (module.start) {
          this.logger.info(`Starting ${module.name}`);
          await module.start(this.container, this.lifecycle.signal);
        }
      }
      this.logger.info(`Server is running on port ${port}`);
      void this.runReady();
    });

    serverInstance.on('close', async () => {
      await this.shutdown();
    });

    process
      .once('SIGINT', () => {
        this.logger.info('SIGINT received');
        this.gracefulClose(serverInstance, controller, this.shutdownGraceMs);
      })
      .once('SIGTERM', () => {
        this.logger.info('SIGTERM received');
        this.gracefulClose(serverInstance, controller, this.shutdownGraceMs);
      });

    return serverInstance;
  }

  /**
   * Resolves once the `ready` phase has finished, i.e. after every module's `ready` hook has
   * settled and `Boot complete` is logged. Useful for tests and for callers that need to wait
   * for background startup work rather than just the socket being bound.
   *
   * A failing `ready` hook does not prevent this from resolving — hooks are fault-isolated. It
   * does *not* resolve if a `start` hook throws: boot failed, so there is no ready state to
   * await. That is intentional.
   *
   * @returns A promise that settles when the ready phase completes.
   */
  public whenReady(): Promise<void> {
    return this.readyPromise;
  }

  /**
   * The lifecycle {@link AbortSignal}, aborted as soon as the server starts winding down.
   *
   * The same signal every `start` and `ready` hook receives, exposed for wiring into things
   * constructed outside a module hook — chiefly long-lived responses, which must be told to
   * unwind or they hold `server.close()` open until the grace period force-closes them:
   *
   * ```typescript
   * builder.setupRoutes([serverFeedRouter({ signal: builder.lifecycleSignal })]);
   * ```
   *
   * Available from construction, so routes can be wired before {@link setup} or {@link start}.
   */
  public get lifecycleSignal(): AbortSignal {
    return this.lifecycle.signal;
  }

  /**
   * Marks the server as winding down, aborting the lifecycle signal. Idempotent, and called from
   * both entry points — a signal handler via {@link gracefulClose}, or {@link shutdown} directly.
   */
  private beginShutdown(): void {
    if (!this.lifecycle.signal.aborted) this.lifecycle.abort();
  }

  /**
   * Runs each module's `ready` hook in registration order, after the server has reported ready.
   *
   * Kicked off un-awaited by {@link start}, so slow background work (pollers, schedulers, cache
   * warms, outbound connections) neither delays boot nor blocks the modules registered after it.
   * Each hook receives the lifecycle {@link AbortSignal} so an in-flight hook can unwind when
   * shutdown begins. A hook that throws is logged and the remaining modules still run. Stops
   * early once {@link shutdown} has begun, and always resolves {@link whenReady} so callers
   * cannot hang.
   */
  private async runReady(): Promise<void> {
    this.readyRunning = true;
    try {
      for (const module of this.modules) {
        if (this.lifecycle.signal.aborted) break;
        if (!module.ready) continue;

        this.logger.info(`Ready ${module.name}`);
        try {
          await module.ready(this.container, this.lifecycle.signal);
        } catch (err) {
          this.onErrorListener(err);
        }
      }

      if (!this.lifecycle.signal.aborted) {
        this.logger.info('Boot complete');
      }
    } finally {
      this.readyRunning = false;
      this.resolveReady();
    }
  }

  /**
   * Gives an in-flight `ready` hook a bounded window to unwind before the `shutdown` hooks run.
   *
   * Aborting the lifecycle signal only helps hooks that honour it, and tearing a service down
   * while its own `ready` hook is still mid-flight races start-up against shutdown. So shutdown
   * waits here — but never indefinitely: a hook that ignores the signal is abandoned once the
   * grace period elapses, and shutdown proceeds. Returns immediately when the ready phase is not
   * running, which is the common case (no `ready` hooks, or boot already finished).
   */
  private async awaitReadyPhase(): Promise<void> {
    if (!this.readyRunning) return;

    const abandoned = Symbol('abandoned');
    const deadline = new Promise<typeof abandoned>(resolve => {
      setTimeout(() => resolve(abandoned), this.shutdownGraceMs).unref();
    });

    if ((await Promise.race([this.readyPromise, deadline])) === abandoned) {
      this.logger.warn(`Ready phase did not unwind within ${this.shutdownGraceMs}ms; shutting down anyway`);
      // Don't wait again on a subsequent shutdown: we have already given up on this hook.
      this.readyRunning = false;
    }
  }

  /**
   * Stops the server on a shutdown signal without hanging on long-lived connections.
   *
   * Aborting the listen signal makes Node call `server.close()`, but `close()` only emits its
   * `close` event (which runs the module {@link shutdown} hooks and exits) once **every** open
   * connection has ended. A long-lived SSE stream or an idle HTTP keep-alive socket never ends on
   * its own, so `close()` would wait forever and the process would keep its port bound. This closes
   * idle sockets immediately, then force-closes any still-active ones after a grace period so
   * in-flight requests get a chance to drain first while the default can never hang.
   *
   * The lifecycle signal is aborted here rather than in {@link shutdown}, because `shutdown` runs
   * off the socket's `close` event — which cannot fire until those long-lived connections have
   * ended. Anything holding a socket open (an SSE stream wired to {@link lifecycleSignal}) has to
   * be told to unwind *now*, at the signal, or it would only ever hear about shutdown after being
   * force-closed.
   *
   * @param serverInstance - The Node HTTP server returned by {@link start}.
   * @param controller - The abort controller wired to the listen signal.
   * @param graceMs - Milliseconds to drain in-flight requests before force-closing.
   */
  private gracefulClose(serverInstance: Server, controller: AbortController, graceMs: number): void {
    this.beginShutdown();
    controller.abort();
    serverInstance.closeIdleConnections();

    if (graceMs <= 0) {
      serverInstance.closeAllConnections();
      return;
    }

    // Don't let the drain timer itself keep the event loop alive: once the last
    // socket closes on its own, close() completes and the process can exit early.
    setTimeout(() => serverInstance.closeAllConnections(), graceMs).unref();
  }

  /**
   * Runs each module's `shutdown` hook in order, then terminates the process.
   *
   * Invoked automatically when the server socket closes; can also be called directly. Calls
   * `process.exit()` once all hooks complete.
   *
   * Aborts the lifecycle signal (if a signal handler has not already done so via
   * {@link gracefulClose}), which halts the `ready` phase: any module whose `ready` hook has not
   * started is skipped, and one already in flight is asked to unwind. {@link awaitReadyPhase}
   * then waits a bounded period for it, so a service is not torn down while its own `ready` hook
   * is still running. Idempotent — a second call (e.g. an explicit call followed by the socket's
   * `close` event) is a no-op rather than a second pass over the hooks.
   *
   * @throws {ServerkitError} If called before {@link setup} has built the container.
   */
  protected async shutdown() {
    this.assertInitialized();
    // Tracked separately from the lifecycle signal: SIGINT/SIGTERM abort that signal well before
    // this runs, so an "already aborted?" guard here would skip the hooks entirely.
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    this.beginShutdown();
    this.logger.info('Server closing');
    await this.awaitReadyPhase();

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
