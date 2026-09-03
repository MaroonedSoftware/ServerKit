import type { FastifyPluginAsync } from 'fastify';
import { ServerFeed } from '@maroonedsoftware/serverfeed';
import { handleServerFeed } from '@maroonedsoftware/servercore/serverfeed';
import type { SseStreamOptions } from '@maroonedsoftware/servercore';
import { requirePolicy, type RequirePolicyOptions } from '../hooks/require.policy.hook.js';
import type { ServerKitContext } from '../serverkit.context.js';
import { requestHeader } from '../request/request.accessors.js';

/**
 * A Fastify adapter for `@maroonedsoftware/serverfeed`: a Server-Sent Events feed over the
 * realtime server feed bus. The bus-to-frame mapping is `handleServerFeed` from
 * `@maroonedsoftware/servercore/serverfeed`; this file only mounts it on a guarded route.
 *
 * `@maroonedsoftware/serverfeed` is an optional peer of `@maroonedsoftware/fastify`: this module
 * is reachable only via the `@maroonedsoftware/fastify/serverfeed` subpath, so base fastify
 * users who never import it don't need the peer installed.
 */

/** Options for {@link serverFeedRoutes}. */
export interface ServerFeedRoutesOptions extends SseStreamOptions {
  /** Route path to mount the stream on. Default `'/server/feed'`. */
  path?: string;
  /**
   * Policy passed to {@link requirePolicy} guarding the route. Defaults to the standard MFA
   * gate; pass `false` to require only a valid session, or a policy name to swap the rule.
   */
  policy?: RequirePolicyOptions['policy'];
  /** How to obtain the bus for a request. Defaults to `request.container.get(ServerFeed)`. */
  resolveFeed?: (request: ServerKitContext) => ServerFeed;
}

/** Default bus resolver: pull {@link ServerFeed} from the request-scoped DI container. */
function defaultResolveFeed(request: ServerKitContext): ServerFeed {
  return request.container.get(ServerFeed);
}

/**
 * Build a Fastify plugin exposing `GET /server/feed` (configurable) as an authenticated SSE feed
 * over the server feed bus. Register it with the server builder like any other route plugin, and
 * register a {@link ServerFeed} instance in DI (or supply `resolveFeed`) so the handler can find
 * the bus.
 *
 * The guard runs as an `onRequest` hook rather than a `preHandler`, so an unauthorised client is
 * rejected before the socket is taken over.
 *
 * @param options - Path, policy, bus resolver, and stream tuning; see {@link ServerFeedRoutesOptions}.
 * @returns A route plugin with the SSE route mounted, guarded by {@link requirePolicy}.
 *
 * @example
 * ```typescript
 * import { serverFeedRoutes } from '@maroonedsoftware/fastify/serverfeed';
 * builder.setupRoutes([serverFeedRoutes({ signal: builder.lifecycleSignal })]);
 * ```
 */
export function serverFeedRoutes(options: ServerFeedRoutesOptions = {}): FastifyPluginAsync {
  const { path = '/server/feed', policy, resolveFeed = defaultResolveFeed, ...streamOptions } = options;

  return async app => {
    app.get(path, { onRequest: [requirePolicy(policy === undefined ? {} : { policy })] }, async (request, reply) => {
      const feed = resolveFeed(request);
      handleServerFeed(
        {
          res: reply.raw,
          hijack: () => void reply.hijack(),
          query: request.query as Record<string, unknown>,
          get: name => requestHeader(request, name),
        },
        feed,
        streamOptions,
      );
    });
  };
}
