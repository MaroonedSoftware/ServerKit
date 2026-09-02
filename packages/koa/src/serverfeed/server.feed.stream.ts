import { ServerFeed, type ServerFeedEvent, type ServerFeedFilter, type ServerFeedKind, type ServerFeedLevel } from '@maroonedsoftware/serverfeed';
import { ServerKitRouter, type ServerKitRouterType } from '../serverkit.router.js';
import { requirePolicy, type RequirePolicyOptions } from '../middleware/router/require.policy.middleware.js';
import {
  firstQueryValue,
  openSseStream,
  resolveLastEventId,
  type SseContext,
  type SseFrame,
  type SseStreamOptions,
} from '@maroonedsoftware/servercore';
import type { ServerKitContext } from '../serverkit.context.js';

/**
 * A koa adapter for `@maroonedsoftware/serverfeed`: a Server-Sent Events feed over the realtime
 * server feed bus. The transport (socket takeover, headers, heartbeat, backpressure) is the
 * package's own SSE module; this file only maps between the bus and SSE frames.
 *
 * `@maroonedsoftware/serverfeed` is an optional peer of `@maroonedsoftware/koa`: this module is
 * reachable only via the `@maroonedsoftware/koa/serverfeed` subpath, so base koa users who never
 * import it don't need the peer installed.
 */

const LEVELS: readonly ServerFeedLevel[] = ['debug', 'info', 'warn', 'error'];
const KINDS: readonly ServerFeedKind[] = ['progress', 'status', 'log', 'error', 'heartbeat'];

/** The SSE event name bus events are published under; namespaced so it cannot collide with another feed multiplexed onto a stream later. */
const SERVER_FEED_EVENT = 'server.feed';

/**
 * The SSE event telling a client its resume point was too old (the events it missed have
 * already been evicted), so it should re-seed current state from the snapshot.
 */
const RESYNC_EVENT = 'resync';

/** The context {@link handleServerFeed} needs: an SSE-capable ctx plus the request inputs. */
export interface ServerFeedContext extends SseContext {
  query: Record<string, unknown>;
  get(header: string): string;
}

/** Frame a bus event, using its monotonic id as the `Last-Event-ID` resume key. */
function serverFeedFrame(event: ServerFeedEvent): SseFrame {
  return { id: event.id, event: SERVER_FEED_EVENT, data: event };
}

/**
 * Build a {@link ServerFeedFilter} from a koa query object, accepting a
 * `?source=a,b&kind=progress,status&level=warn&correlationId=…` grammar (comma lists for
 * `source`/`kind`, unknown kinds dropped). Zero-dependency — no schema library needed.
 *
 * @param query - The raw koa query object.
 * @returns The parsed filter; an empty object when nothing usable was supplied.
 */
export function serverFeedFilterFromQuery(query: Record<string, unknown>): ServerFeedFilter {
  const filter: ServerFeedFilter = {};

  const source = firstQueryValue(query.source);
  if (source) {
    const sources = source
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (sources.length > 0) filter.source = sources;
  }

  const correlationId = firstQueryValue(query.correlationId);
  if (correlationId) filter.correlationId = correlationId;

  const level = firstQueryValue(query.level);
  if (level && (LEVELS as readonly string[]).includes(level)) filter.level = level as ServerFeedLevel;

  const kind = firstQueryValue(query.kind);
  if (kind) {
    const kinds = kind
      .split(',')
      .map(s => s.trim())
      .filter((k): k is ServerFeedKind => (KINDS as readonly string[]).includes(k));
    if (kinds.length > 0) filter.kind = kinds;
  }

  return filter;
}

/**
 * Open an SSE feed over the server feed bus: replay the backlog from the client's resume point,
 * then stream live matching events until the socket closes.
 *
 * A client whose resume point predates the replay buffer gets a `resync` event first, so it
 * knows to re-seed current state from the snapshot rather than silently missing events. The
 * bus subscription is torn down with the stream.
 *
 * @param ctx - The (structural) request context; its `res` is taken over for the stream.
 * @param feed - The bus to stream from.
 * @param options - Heartbeat and backpressure tuning; see {@link SseStreamOptions}.
 */
export function handleServerFeed(ctx: ServerFeedContext, feed: ServerFeed, options: SseStreamOptions = {}): void {
  const filter = serverFeedFilterFromQuery(ctx.query);
  const lastId = resolveLastEventId(ctx.get('Last-Event-ID'), ctx.query.lastEventId);

  const stream = openSseStream(ctx, options);

  const { events, gap } = feed.replaySince(lastId, filter);
  if (gap) stream.event({ event: RESYNC_EVENT, data: {} });
  for (const event of events) stream.event(serverFeedFrame(event));

  // Registered after the replay on purpose: if backpressure already closed the stream,
  // `onClose` unsubscribes immediately rather than leaking the subscription.
  stream.onClose(feed.onEvent(filter, event => stream.event(serverFeedFrame(event))));
}

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
