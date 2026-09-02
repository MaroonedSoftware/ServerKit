import { Container, Registry } from 'injectkit';
import Koa from 'koa';
import type { Server } from 'node:http';
import { ServerkitError } from '@maroonedsoftware/errors';
import { ServerKitServerBuilderBase } from '@maroonedsoftware/servercore';
import { ServerKitContext } from './serverkit.context.js';
import { ServerKitMiddleware } from './serverkit.middleware.js';
import { serverKitDefaultMiddleware } from './middleware/server/serverkit.default.middlewares.js';
import { ServerKitRouterType } from './serverkit.router.js';

export { DEFAULT_SHUTDOWN_GRACE_MS, type ServerKitStartOptions } from '@maroonedsoftware/servercore';

/**
 * Fluent builder that wires an InjectKit-backed Koa server through its full lifecycle:
 * dependency registration, body-parser setup, middleware and route mounting, listening, and
 * graceful shutdown.
 *
 * The lifecycle itself (module hooks, signal handling, bounded graceful shutdown) is
 * `ServerKitServerBuilderBase` from `@maroonedsoftware/servercore`; this class adds the Koa
 * application, its middleware and router mounting, and the `listen` binding.
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
 * Construction sets Luxon's default zone to UTC and installs a noop container placeholder;
 * lifecycle methods that need the real container throw until {@link setup} has run.
 */
export class ServerKitServerBuilder extends ServerKitServerBuilderBase {
  private readonly server: Koa;

  constructor() {
    super();
    this.server = new Koa();
  }

  /**
   * Registers {@link ServerKitContext} as a **scoped** placeholder, after the modules have had
   * their say, so services may declare it as a constructor dependency: the request-scoped
   * container overrides it with the live request context, and resolving it outside a request
   * scope throws. A singleton that depends on it fails validation at build time, as it should.
   * Skipped when a module registered its own.
   */
  protected override finalizeRegistry(registry: Registry): void {
    if (!registry.isRegistered(ServerKitContext)) {
      registry
        .register(ServerKitContext)
        .useFactory(() => {
          throw new ServerkitError('ServerKitContext is only available inside a request scope');
        })
        .asScoped();
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
   * Binds the Koa application, routing its `error`/`warn` events to the lifecycle logger.
   * Resolves with the Node HTTP server once it is listening.
   */
  protected listen(port: number, signal: AbortSignal): Promise<Server> {
    this.server.on('error', err => this.onErrorListener(err));
    this.server.on('warn', err => this.onWarnListener(err));

    return new Promise((resolve, reject) => {
      const onBindError = (err: Error): void => reject(err);
      const serverInstance = this.server.listen({ port, signal, captureRejections: true }, () => {
        serverInstance.off('error', onBindError);
        resolve(serverInstance);
      });
      serverInstance.once('error', onBindError);
    });
  }
}
