# @maroonedsoftware/serverfeed

A framework-agnostic, in-process realtime feed of server activity for ServerKit. Producers publish structured progress / status / error / log events; subscribers (an SSE transport, tests, a dashboard) receive the live events matching a filter. A bounded replay buffer lets a reconnecting client catch up by `Last-Event-ID`, and a latest-per-key snapshot renders current state without replaying the whole buffer.

The package is transport-free: no HTTP, DB, DI, logger, or wire-format dependency. `replaySince` hands a transport the events a reconnecting client missed plus a `gap` flag, and the transport decides how to deliver them. Thin adapters ship as opt-in subpaths, so the bare bus loads none of them:

- **SSE feed** — [`@maroonedsoftware/koa/serverfeed`](../koa#server-feed-sse-endpoint), built on [koa's SSE transport](../koa#server-sent-events)
- **Logger bridge** — [`@maroonedsoftware/serverfeed/logger`](#logger-bridge)

## Features

- **Typed wire contract** — one `ServerFeedEvent` shape shared by publisher, transport, and consumer
- **Ergonomic publish helpers** — `progress` / `status` / `log` / `reportError` / `heartbeat`
- **Filtered subscribe** — AND-semantics filter on `source` / `correlationId` / `level` (min-severity) / `kind`
- **Bounded replay** — ring buffer with monotonic ids for `Last-Event-ID` resume, and a `gap` flag when the resume point predates the buffer
- **Latest-per-key snapshot** — current state per `${source}:${correlationId}`, recency-evicted
- **Resilient fan-out** — a throwing listener can't break delivery to the others
- **One runtime dep** — [luxon](https://www.npmjs.com/package/luxon), for the event timestamp

## Installation

```bash
pnpm add @maroonedsoftware/serverfeed
```

## Quick start

### Publish

```typescript
import { ServerFeed } from '@maroonedsoftware/serverfeed';

const feed = new ServerFeed({ bufferSize: 1000 });

// Step progress for a correlated operation (level derived from status).
feed.progress('render', 'show:friday', { phase: 'writing', index: 3, total: 8, status: 'running' });

// A status/feedback line.
feed.status('render', 'show:friday', 'segment 3 written', { chars: 412 });

// An error (an Error is flattened to message + stack).
feed.reportError('llm', new Error('model timed out'), 'call-42');

// A liveness ping for an in-flight operation (kept out of the snapshot map).
feed.heartbeat('llm', 'call-42');
```

### Subscribe

```typescript
// Live events matching a filter (AND semantics; `level` is an inclusive minimum).
const unsubscribe = feed.onEvent({ source: ['render', 'llm'], level: 'warn' }, event => {
  console.log(event.kind, event.message);
});

unsubscribe();
```

### Replay + snapshot

```typescript
// Everything newer than a resume point; `gap` means the client fell behind the buffer.
const { events, gap } = feed.replaySince(lastEventId, { source: 'render' });

// Current state per correlation key, without replaying the whole buffer.
const current = feed.snapshot({ source: 'render' });
```

### Bridge to a transport

A transport replays what the client missed, then subscribes for the rest. The `gap` flag means the resume point predates the buffer, so the client should re-seed from `snapshot()` rather than silently miss events. That is the whole contract — around 6 lines, which is why the package ships no transport of its own:

```typescript
const { events, gap } = feed.replaySince(lastEventId, filter);
if (gap) send({ event: 'resync' });
for (const event of events) send(event);

const unsubscribe = feed.onEvent(filter, send);
```

See [`@maroonedsoftware/koa/serverfeed`](../koa#server-feed-sse-endpoint) for the SSE implementation of exactly this.

## API

### `ServerFeed`

| Member                                                | Description                                                                                  |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `new ServerFeed(options?)`                            | `bufferSize` (default 1000), `snapshotCap` (default 500), `now` (epoch-ms clock, for tests). |
| `publish(input): ServerFeedEvent`                     | Publish a raw event; the bus assigns a monotonic `id` and (unless given) `ts`.               |
| `progress(source, correlationId, progress, message?)` | Step progress; `error` level when `status === 'failed'`, else `info`.                        |
| `status(source, correlationId, message, data?)`       | A status/feedback line at `info`.                                                            |
| `log(level, source, message, data?)`                  | Mirror a log line onto the bus (used by the logger bridge).                                  |
| `reportError(source, err, correlationId?)`            | An error; an `Error` is flattened to `message` + `data.stack`.                               |
| `heartbeat(source, correlationId?, data?)`            | A `debug` liveness ping, excluded from the snapshot map.                                     |
| `onEvent(filter, listener): () => void`               | Subscribe to matching live events; returns an unsubscribe function.                          |
| `replaySince(lastId, filter?)`                        | Buffered events newer than `lastId`, plus a `gap` flag for a stale resume point.             |
| `snapshot(filter?)`                                   | Latest progress/status/error event per correlation key.                                      |

### Event contract (`server.feed.event.ts`)

- `ServerFeedEvent` / `ServerFeedEventInput` — the wire shape (`id`, `ts` assigned by the bus).
- `ServerFeedLevel` (`debug < info < warn < error`), `ServerFeedKind` (`progress | status | log | error | heartbeat`), `ServerFeedProgress`.
- `ServerFeedFilter` — `source` (string or list), `correlationId`, `level` (inclusive minimum), `kind` (one or a list).
- `levelRank(level)` and `matches(event, filter?)` — the filter primitives.

## Logger bridge

The `@maroonedsoftware/serverfeed/logger` subpath adds `ServerFeedLogger`, a decorator that mirrors qualifying log lines onto the bus, so the existing logger interface feeds a realtime console without every caller learning a new API. By default only `warn`+`error` are forwarded (`info`/`debug` are chatty; `trace` is never mirrored); pass a lower minimum bus level to widen that.

`@maroonedsoftware/logger` is an **optional peer** of this package, needed only for this subpath — the bare bus installs without it. The bridge lives here rather than in the logger package so `@maroonedsoftware/logger` stays standalone, with no dependencies of any kind.

```typescript
import { ConsoleLogger, Logger } from '@maroonedsoftware/logger';
import { ServerFeed } from '@maroonedsoftware/serverfeed';
import { ServerFeedLogger } from '@maroonedsoftware/serverfeed/logger';

const feed = new ServerFeed();

// Wrap any Logger; warn+error (default) are mirrored onto the bus.
registry.register(Logger).useInstance(new ServerFeedLogger(new ConsoleLogger(), feed));

// Widen to also mirror info:
const chatty = new ServerFeedLogger(new ConsoleLogger(), feed, 'info');
```

| Constructor                                               | Description                                                                                                                                  |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `new ServerFeedLogger(inner, feed, minBusLevel = 'warn')` | Delegates every call to `inner` and mirrors lines at or above `minBusLevel` (never `trace`) onto `feed` as `log` events with source `'log'`. |

## License

MIT — see [LICENSE](./LICENSE).
