import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import { Container, Registry } from 'injectkit';
import type { Server } from 'node:http';
import { ServerkitError } from '@maroonedsoftware/errors';
import { ServerKitServerBuilderBase } from '@maroonedsoftware/servercore';
import { ServerKitContext } from './serverkit.context.js';
import { ServerKitPlugin } from './serverkit.plugin.js';
import { serverKitDefaultPlugins } from './plugins/serverkit.default.plugins.js';
import { ServerKitRouterType } from './serverkit.router.js';

export { DEFAULT_SHUTDOWN_GRACE_MS, type ServerKitStartOptions } from '@maroonedsoftware/servercore';

/** Options for {@link ServerKitServerBuilder}. */
export interface ServerKitFastifyOptions {
  /**
   * Interface to bind on `start`. Defaults to `'::'`, every interface (dual-stack, IPv4-mapped),
   * matching what a Koa app binds by default. Fastify's own default is `localhost`, which is
   * unreachable from outside a container; pass `'0.0.0.0'` on a host without IPv6.
   */
  host?: string;
  /** Options forwarded to `Fastify()`. Logging is off by default; ServerKit logs through `Logger`. */
  fastify?: FastifyServerOptions;
}

/**
 * Fluent builder that wires an InjectKit-backed Fastify server through its full lifecycle:
 * dependency registration, body-parser setup, plugin and route registration, listening, and
 * graceful shutdown.
 *
 * The lifecycle itself (module hooks, signal handling, bounded graceful shutdown) is
 * `ServerKitServerBuilderBase` from `@maroonedsoftware/servercore`; this class adds the Fastify
 * instance, its plugin and route registration, and the `listen` binding.
 *
 * Typical usage runs {@link setup} (which returns the built container), then chains
 * {@link setupPlugins} → {@link setupRoutes}, then {@link start}:
 * ```typescript
 * const builder = new ServerKitServerBuilder();
 * await builder.setup(config, logger, modules);
 * builder.setupPlugins().setupRoutes([router]);
 * await builder.start(3000);
 * ```
 *
 * Body parsing is lazy and per route, as on Koa: Fastify's built-in JSON and text parsers are
 * removed at construction and a no-op catch-all is installed, so `request.raw` is left unread
 * until a route's `bodyParserMiddleware` consumes it. Fastify's `request.body` is therefore
 * never populated; handlers read `request.parsedBody`.
 *
 * Construction sets Luxon's default zone to UTC and installs a noop container placeholder;
 * lifecycle methods that need the real container throw until {@link setup} has run.
 */
export class ServerKitServerBuilder extends ServerKitServerBuilderBase {
  private readonly server: FastifyInstance;
  private readonly host: string;

  constructor(options: ServerKitFastifyOptions = {}) {
    super();
    this.host = options.host ?? '::';
    this.server = Fastify({ logger: false, ...options.fastify });

    // ServerKit parses lazily per route (see the class docs). Every content type, including a
    // missing one, resolves to this catch-all, which leaves the raw stream untouched.
    this.server.removeAllContentTypeParsers();
    this.server.addContentTypeParser('*', (_request, _payload, done) => done(null, undefined));
  }

  /**
   * The underlying Fastify instance: the escape hatch for registering plugins ServerKit does
   * not wrap (OpenAPI, static files, ...) and for `app.inject()` in tests. Registrations made
   * here follow Fastify's own rules; a request that reaches them still carries the ServerKit
   * context once {@link setupPlugins} has run.
   */
  public get app(): FastifyInstance {
    return this.server;
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
   * Registers the plugins produced by the given factory on the Fastify instance, in order.
   *
   * Every plugin is `fastify-plugin`-wrapped, so its hooks apply to the whole server, and Fastify
   * loads them in registration order — which is what makes the canonical stack order a contract.
   * Registration is queued, not awaited: a plugin that fails rejects the first `listen()`,
   * `ready()`, or `inject()`. Call this before {@link setupRoutes}.
   *
   * @param plugins - Factory called with the built container; defaults to {@link serverKitDefaultPlugins}.
   * @returns This builder, for chaining.
   * @throws {ServerkitError} If called before {@link setup} has built the container.
   */
  public setupPlugins(plugins: (container: Container) => ServerKitPlugin[] = serverKitDefaultPlugins): this {
    this.assertInitialized();
    for (const plugin of plugins(this.container)) {
      void this.server.register(plugin);
    }
    return this;
  }

  /**
   * Mounts routers on the Fastify instance, after the plugin stack.
   *
   * @param routes - Routers whose routes are registered, each under its own prefix when it has one.
   * @returns This builder, for chaining.
   */
  public setupRoutes(routes: ServerKitRouterType[]): this {
    for (const route of routes) {
      void this.server.register(route.routes(), route.prefix === undefined ? {} : { prefix: route.prefix });
    }
    return this;
  }

  /**
   * Binds the Fastify instance (which also runs every pending plugin registration), resolving
   * with the Node HTTP server once it is listening. Aborting `signal` makes Fastify close, which
   * runs its `onClose` hooks and then the server's `close`, driving the shared shutdown.
   */
  protected async listen(port: number, signal: AbortSignal): Promise<Server> {
    await this.server.listen({ port, host: this.host, signal });
    return this.server.server;
  }
}
