import { ServerFeed } from '@maroonedsoftware/serverfeed';
import { handleServerFeed, type ServerFeedContext } from '@maroonedsoftware/servercore/serverfeed';
import type { SseStreamOptions } from '@maroonedsoftware/servercore';
import { ServerKitRouter, type ServerKitRouterType } from '../serverkit.router.js';
import { requirePolicy, type RequirePolicyOptions } from '../middleware/router/require.policy.middleware.js';
import type { ServerKitContext } from '../serverkit.context.js';

/**
 * A koa adapter for `@maroonedsoftware/serverfeed`: a Server-Sent Events feed over the realtime
 * server feed bus. The bus-to-frame mapping is `handleServerFeed` from
 * `@maroonedsoftware/servercore/serverfeed`; this file only mounts it on a guarded Koa route.
 *
 * `@maroonedsoftware/serverfeed` is an optional peer of `@maroonedsoftware/koa`: this module is
 * reachable only via the `@maroonedsoftware/koa/serverfeed` subpath, so base koa users who never
 * import it don't need the peer installed.
 */

/** Options for {@link serverFeedRouter}. */
export interface ServerFeedRouterOptions extends SseStreamOptions {
  /** Route path to mount the stream on. Default `'/server/feed'`. */
  path?: string;
  /**
   * Policy passed to {@link requirePolicy} guarding the route. Defaults to the standard MFA
   * gate; pass `false` to require only a valid session, or a policy name to swap the rule.
   */
  policy?: RequirePolicyOptions['policy'];
  /** How to obtain the bus for a request. Defaults to `ctx.container.get(ServerFeed)`. */
  resolveFeed?: (ctx: ServerKitContext) => ServerFeed;
}

/** Default bus resolver: pull {@link ServerFeed} from the request-scoped DI container. */
function defaultResolveFeed(ctx: ServerKitContext): ServerFeed {
  return ctx.container.get(ServerFeed);
}

/**
 * Build a {@link ServerKitRouterType} exposing `GET /server/feed` (configurable) as an
 * authenticated SSE feed over the server feed bus. Register the router with the server builder
 * like any other; register a {@link ServerFeed} instance in DI (or supply `resolveFeed`)
 * so the handler can find the bus.
 *
 * @param options - Path, policy, bus resolver, and stream tuning; see {@link ServerFeedRouterOptions}.
 * @returns A router with the SSE route mounted, guarded by {@link requirePolicy}.
 *
 * @example
 * ```typescript
 * import { serverFeedRouter } from '@maroonedsoftware/koa/serverfeed';
 * builder.setupRoutes([serverFeedRouter()]);
 * ```
 */
export function serverFeedRouter(options: ServerFeedRouterOptions = {}): ServerKitRouterType {
  const { path = '/server/feed', policy, resolveFeed = defaultResolveFeed, ...streamOptions } = options;
  const router = ServerKitRouter();

  router.get(path, requirePolicy(policy === undefined ? {} : { policy }), async ctx => {
    const feed = resolveFeed(ctx as unknown as ServerKitContext);
    handleServerFeed(ctx as unknown as ServerFeedContext, feed, streamOptions);
  });

  // `ServerKitRouterType` is the erased `Router<unknown, unknown>` (invariant in its context
  // type), so the concrete router needs a cast to satisfy it — the same cast callers would
  // otherwise apply when passing routers to `setupRoutes`.
  return router as unknown as ServerKitRouterType;
}
