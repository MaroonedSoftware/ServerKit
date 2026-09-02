import { ServerFeed, type ServerFeedEvent, type ServerFeedFilter, type ServerFeedKind, type ServerFeedLevel } from '@maroonedsoftware/serverfeed';
import { openSseStream, type SseContext, type SseStreamOptions } from '../sse/sse.stream.js';
import { firstQueryValue, resolveLastEventId } from '../sse/sse.request.js';
import type { SseFrame } from '../sse/sse.frame.js';

/**
 * The framework-neutral half of a serverfeed SSE endpoint: a Server-Sent Events feed over the
 * realtime server feed bus. The transport (socket takeover, headers, heartbeat, backpressure) is
 * the package's own SSE module; this file only maps between the bus and SSE frames. Each HTTP
 * adapter (`@maroonedsoftware/koa/serverfeed`, `@maroonedsoftware/fastify/serverfeed`) mounts
 * {@link handleServerFeed} on a guarded route.
 *
 * `@maroonedsoftware/serverfeed` is an optional peer of `@maroonedsoftware/servercore`: this
 * module is reachable only via the `@maroonedsoftware/servercore/serverfeed` subpath, so users
 * who never import it don't need the peer installed.
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
  /** The parsed query string, as the framework exposes it. */
  query: Record<string, unknown>;
  /** Case-insensitive request header accessor returning `''` when absent. */
  get(header: string): string;
}

/** Frame a bus event, using its monotonic id as the `Last-Event-ID` resume key. */
function serverFeedFrame(event: ServerFeedEvent): SseFrame {
  return { id: event.id, event: SERVER_FEED_EVENT, data: event };
}

/**
 * Build a {@link ServerFeedFilter} from a parsed query object, accepting a
 * `?source=a,b&kind=progress,status&level=warn&correlationId=…` grammar (comma lists for
 * `source`/`kind`, unknown kinds dropped). Zero-dependency — no schema library needed.
 *
 * @param query - The raw query object.
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
