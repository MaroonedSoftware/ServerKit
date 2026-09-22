import { Container, Registry } from 'injectkit';
import Koa from 'koa';
import type { Server } from 'node:http';
import { IsHttpError, ServerkitError } from '@maroonedsoftware/errors';
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
/**
 * The request fields logged alongside an error or warning Koa emits for a request. `path` is
 * `ctx.path`, never `ctx.url`, because the query string can carry credentials (tokens, signed-URL
 * signatures) that must not reach the logs. `requestId` and `correlationId` are absent when the
 * failure happened before `serverKitContextMiddleware` ran.
 */
const requestLogMeta = (ctx: ServerKitContext): Record<string, unknown> => ({
  method: ctx.method,
  path: ctx.path,
  status: ctx.status,
  requestId: ctx.requestId,
  correlationId: ctx.correlationId,
});

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
   * Koa emits both as `(error, ctx)`, and the context is forwarded so the log line carries the
   * request it came from. Resolves with the Node HTTP server once it is listening.
   */
  protected listen(port: number, signal: AbortSignal): Promise<Server> {
    this.server.on('error', (err: unknown, ctx?: ServerKitContext) => this.onErrorListener(err, ctx));
    this.server.on('warn', (err: unknown, ctx?: ServerKitContext) => this.onWarnListener(err, ctx));

    return new Promise((resolve, reject) => {
      const onBindError = (err: Error): void => reject(err);
      const serverInstance = this.server.listen({ port, signal, captureRejections: true }, () => {
        serverInstance.off('error', onBindError);
        resolve(serverInstance);
      });
      serverInstance.once('error', onBindError);
    });
  }

  /**
   * Logs an error Koa emitted, with the request's method, path, status, and request and
   * correlation IDs when a context came with it. A 4xx `HttpError` is the caller's fault, not the
   * server's, so it logs at `warn`; everything else logs at `error`. Without a context (a `ready`
   * hook failure, a server-level error) it falls back to the base behaviour.
   */
  protected override onErrorListener(err: unknown, ctx?: ServerKitContext): void {
    if (!ctx) {
      super.onErrorListener(err);
      return;
    }
    if (IsHttpError(err) && err.statusCode < 500) {
      this.logger.warn(err, requestLogMeta(ctx));
    } else {
      this.logger.error(err, requestLogMeta(ctx));
    }
  }

  /** Logs a warning Koa emitted (e.g. a synthesised 404), with the request fields when a context came with it. */
  protected override onWarnListener(err: unknown, ctx?: ServerKitContext): void {
    if (!ctx) {
      super.onWarnListener(err);
      return;
    }
    this.logger.warn(err, requestLogMeta(ctx));
  }
}
