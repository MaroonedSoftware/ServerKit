import type { FastifyPluginAsync, HTTPMethods, RouteHandlerMethod, preHandlerAsyncHookHandler } from 'fastify';
import type { ServerKitRouteHandler, ServerKitRouterMiddleware } from './serverkit.middleware.js';

/** Options for {@link ServerKitRouter}. */
export interface ServerKitRouterOptions {
  /** Path prefix applied to every route in this router when it is mounted, e.g. `'/api'`. */
  prefix?: string;
}

/** The handler list a route method takes: zero or more guards, then the handler last. */
export type ServerKitRouteHandlers = [...ServerKitRouterMiddleware[], ServerKitRouteHandler];

/**
 * A router collected the way a Koa app reads, mounted the way Fastify works: each method call
 * records a route, `use` records router-wide guards, and {@link ServerKitRouterType.routes}
 * turns the collection into a Fastify plugin that registers every route with
 * `preHandler: [...routerGuards, ...routeGuards]`.
 */
export interface ServerKitRouterType {
  /** The prefix the server builder mounts this router under. */
  readonly prefix?: string;
  /** Add guards that run before every route in this router, in the order given. */
  use(...middleware: ServerKitRouterMiddleware[]): this;
  get(path: string, ...handlers: ServerKitRouteHandlers): this;
  post(path: string, ...handlers: ServerKitRouteHandlers): this;
  put(path: string, ...handlers: ServerKitRouteHandlers): this;
  patch(path: string, ...handlers: ServerKitRouteHandlers): this;
  delete(path: string, ...handlers: ServerKitRouteHandlers): this;
  head(path: string, ...handlers: ServerKitRouteHandlers): this;
  options(path: string, ...handlers: ServerKitRouteHandlers): this;
  /** The Fastify plugin registering every collected route; `ServerKitServerBuilder.setupRoutes` mounts it under {@link prefix}. */
  routes(): FastifyPluginAsync;
}

interface RouteDefinition {
  method: HTTPMethods;
  url: string;
  middleware: ServerKitRouterMiddleware[];
  handler: ServerKitRouteHandler;
}

class Router implements ServerKitRouterType {
  private readonly shared: ServerKitRouterMiddleware[] = [];
  private readonly definitions: RouteDefinition[] = [];

  constructor(public readonly prefix?: string) {}

  use(...middleware: ServerKitRouterMiddleware[]): this {
    this.shared.push(...middleware);
    return this;
  }

  get(path: string, ...handlers: ServerKitRouteHandlers): this {
    return this.add('GET', path, handlers);
  }

  post(path: string, ...handlers: ServerKitRouteHandlers): this {
    return this.add('POST', path, handlers);
  }

  put(path: string, ...handlers: ServerKitRouteHandlers): this {
    return this.add('PUT', path, handlers);
  }

  patch(path: string, ...handlers: ServerKitRouteHandlers): this {
    return this.add('PATCH', path, handlers);
  }

  delete(path: string, ...handlers: ServerKitRouteHandlers): this {
    return this.add('DELETE', path, handlers);
  }

  head(path: string, ...handlers: ServerKitRouteHandlers): this {
    return this.add('HEAD', path, handlers);
  }

  options(path: string, ...handlers: ServerKitRouteHandlers): this {
    return this.add('OPTIONS', path, handlers);
  }

  routes(): FastifyPluginAsync {
    return async app => {
      for (const definition of this.definitions) {
        app.route({
          method: definition.method,
          url: definition.url,
          preHandler: [...this.shared, ...definition.middleware] as preHandlerAsyncHookHandler[],
          handler: definition.handler as RouteHandlerMethod,
        });
      }
    };
  }

  private add(method: HTTPMethods, url: string, handlers: ServerKitRouteHandlers): this {
    const handler = handlers[handlers.length - 1] as ServerKitRouteHandler;
    const middleware = handlers.slice(0, -1) as ServerKitRouterMiddleware[];
    this.definitions.push({ method, url, middleware, handler });
    return this;
  }
}

/**
 * Creates a new router typed for ServerKit's request context.
 *
 * @param options - Router options; see {@link ServerKitRouterOptions}.
 * @returns A {@link ServerKitRouterType} to define routes on and hand to `setupRoutes`.
 *
 * @example
 * ```typescript
 * const router = ServerKitRouter({ prefix: '/api' });
 * router.post('/invoices', bodyParserMiddleware(['application/json']), requirePolicy(), async request => {
 *   return request.container.get(InvoiceService).create(request.parsedBody);
 * });
 * builder.setupRoutes([router]);
 * ```
 */
export const ServerKitRouter = (options?: ServerKitRouterOptions): ServerKitRouterType => new Router(options?.prefix);
