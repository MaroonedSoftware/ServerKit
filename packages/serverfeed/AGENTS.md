# AGENTS.md — @maroonedsoftware/serverfeed

Machine-oriented guide for AI agents. Human prose and long-form examples live in [README.md](./README.md).
Repo-wide conventions live in the [root AGENTS.md](../../AGENTS.md).

## Purpose

An in-process pub/sub bus for realtime server activity — progress, status, errors, mirrored logs —
with a typed event contract, filtered subscriptions, a bounded replay ring buffer for
`Last-Event-ID` resume, and a latest-per-key snapshot for rendering current state without replaying
everything.

Deliberately transport-free: no HTTP, no DI, no database, no logger. It owns the event contract and
the bus, and nothing else. Framing and connection handling belong to a transport —
`@maroonedsoftware/koa/serverfeed` provides the SSE one. Reach for this when a UI needs to watch
what the server is doing. Do **not** reach for it for durable delivery, cross-process fan-out, or
anything that must survive a restart: the ring buffer is per process and per lifetime.

## Install

```bash
pnpm add @maroonedsoftware/serverfeed
pnpm add @maroonedsoftware/logger   # only if you use the ./logger bridge
```

Runtime dependency: `luxon`. Optional peer: `@maroonedsoftware/logger`.

## Position in the graph

- **Depends on:** nothing internal at runtime. `logger` is an **optional** peer, reachable only
  through the `./logger` subpath.
- **Depended on by:** `koa`, as an **optional** peer for its `@maroonedsoftware/koa/serverfeed` SSE
  transport.
- **Subpath exports:**
  - `.` — the event contract and the `ServerFeed` bus. Loads nothing but `luxon`.
  - `./logger` — `ServerFeedLogger`, a decorator that mirrors qualifying log lines onto a feed.
    It lives here, with `logger` as an optional peer, **specifically so `@maroonedsoftware/logger`
    stays dependency-free**. This is the canonical example of the repo's optional-peer +
    subpath pattern; see the root AGENTS.md.

The SSE transport points the same way: it lives in `koa` (which can afford a `serverfeed`
dependency), not here.

## API surface

### `.` — event contract (`src/server.feed.event.ts`)

| Export                 | Kind      | Shape                                                                                                                         | Notes                                                      |
| ---------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `ServerFeedLevel`      | type      | `'debug' \| 'info' \| 'warn' \| 'error'`                                                                                      | Ordered debug < info < warn < error.                       |
| `ServerFeedKind`       | type      | `'progress' \| 'status' \| 'log' \| 'error' \| 'heartbeat'`                                                                   | —                                                          |
| `ServerFeedProgress`   | interface | `{ phase: string; index: number; total: number; status: 'running' \| 'done' \| 'failed' }`                                    | `index`/`total` are `0` when not step-oriented or unknown. |
| `ServerFeedEvent`      | interface | `{ id, ts, source, level, kind, message?, correlationId?, progress?, data? }`                                                 | `id` and `ts` are assigned by the bus.                     |
| `ServerFeedEventInput` | type      | `Omit<ServerFeedEvent, 'id' \| 'ts'> & { ts?: string }`                                                                       | What a publisher supplies.                                 |
| `ServerFeedFilter`     | interface | `{ source?: string \| string[]; correlationId?: string; level?: ServerFeedLevel; kind?: ServerFeedKind \| ServerFeedKind[] }` | **AND semantics**: every present field must match.         |
| `levelRank`            | function  | `(level: ServerFeedLevel) => number`                                                                                          | `debug=0 … error=3`, for min-severity comparisons.         |
| `matches`              | function  | `(event: ServerFeedEvent, filter?: ServerFeedFilter) => boolean`                                                              | No filter matches everything.                              |

### `.` — the bus (`src/server.feed.ts`)

| Export              | Kind      | Shape                                                                                | Notes                                                                 |
| ------------------- | --------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `ServerFeedOptions` | interface | `{ bufferSize?: number; snapshotCap?: number; now?: () => number }`                  | Defaults 1000 / 500 / current time. Both are clamped to at least 1.   |
| `ServerFeed`        | class     | `new ServerFeed(options?: ServerFeedOptions)`                                        | No DI decorator — register it as a value.                             |
| `#publish`          | method    | `(input: ServerFeedEventInput) => ServerFeedEvent`                                   | Assigns `id` and, unless supplied, `ts`. Returns the completed event. |
| `#progress`         | method    | `(source, correlationId, progress: ServerFeedProgress, message?) => ServerFeedEvent` | Level is `error` when `progress.status === 'failed'`, else `info`.    |
| `#status`           | method    | `(source, correlationId, message, data?) => ServerFeedEvent`                         | `level: 'info'`, `kind: 'status'`.                                    |
| `#log`              | method    | `(level, source, message, data?) => ServerFeedEvent`                                 | `kind: 'log'`. Used by the logger bridge.                             |
| `#reportError`      | method    | `(source, err: unknown, correlationId?) => ServerFeedEvent`                          | Flattens an `Error` to its message, with `stack` in `data`.           |
| `#heartbeat`        | method    | `(source, correlationId?, data?) => ServerFeedEvent`                                 | `level: 'debug'`, `kind: 'heartbeat'`. Never enters the snapshot map. |
| `#onEvent`          | method    | `(filter: ServerFeedFilter, listener: (event) => void) => () => void`                | Returns an unsubscribe function.                                      |
| `#replaySince`      | method    | `(lastId: number, filter?) => { events: ServerFeedEvent[]; gap: boolean }`           | `gap` means the caller missed already-evicted events.                 |
| `#snapshot`         | method    | `(filter?) => ServerFeedEvent[]`                                                     | Latest `progress`/`status`/`error` per `${source}:${correlationId}`.  |

### `./logger`

| Export             | Kind  | Shape                                                                                          | Notes                                                                       |
| ------------------ | ----- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `ServerFeedLogger` | class | `new ServerFeedLogger(inner: Logger, feed: ServerFeed, minBusLevel: ServerFeedLevel = 'warn')` | Extends `Logger`. Delegates every call to `inner`, mirrors qualifying ones. |

Mirrored events are published as `feed.log(level, 'log', message, { params })` — note the hard-coded
source `'log'`. `trace` is **never** mirrored, regardless of `minBusLevel`.

## Canonical usage

```typescript
import { ServerFeed } from '@maroonedsoftware/serverfeed';

const feed = new ServerFeed({ bufferSize: 2000 });

// Producer
feed.status('render', jobId, 'starting render');
feed.progress('render', jobId, { phase: 'encoding', index: 3, total: 8, status: 'running' });
feed.reportError('render', err, jobId);

// Consumer
const unsubscribe = feed.onEvent({ source: 'render', level: 'info' }, event => {
  console.log(event.kind, event.message);
});

// Reconnect
const { events, gap } = feed.replaySince(lastEventId, { correlationId: jobId });
if (gap) {
  // The client missed evicted events — re-seed from current state first
  send(feed.snapshot({ correlationId: jobId }));
}
send(events);
```

Optional logger bridge, wired at the composition root:

```typescript
import { Logger, ConsoleLogger } from '@maroonedsoftware/logger';
import { ServerFeedLogger } from '@maroonedsoftware/serverfeed/logger';

registry.register(Logger).useValue(new ServerFeedLogger(new ConsoleLogger(), feed));
```

## Rules for generated code

- Publish through the helpers (`progress`, `status`, `reportError`, `heartbeat`) rather than raw
  `publish`. They set `level` and `kind` consistently, which is what filters key off.
- Always pass a `correlationId` for anything a UI groups: it is the snapshot key, and an event
  without one never reaches the snapshot map at all.
- Keep `data` small. Every event rides the ring buffer, so a large payload multiplied by
  `bufferSize` is resident memory.
- Handle `gap: true` from `replaySince` by seeding from `snapshot()` before sending the replayed
  events. Ignoring it shows the user a feed that silently skipped work.
- Call the returned unsubscribe function when a subscriber goes away. Subscriptions live in a `Set`
  and are never reaped for you.
- Do not throw from an `onEvent` listener to signal anything — throws are swallowed (see Gotchas).
- Import `ServerFeedLogger` from `@maroonedsoftware/serverfeed/logger`, never from the root.
- Do not add a transport here. A new transport belongs in the package that owns the protocol, with
  `serverfeed` as an optional peer.
- Inject `now` in tests rather than mocking the clock globally.

## Gotchas

- **`id` is process-lifetime, not durable.** It restarts at 1 on every boot. A client resuming with
  a `Last-Event-ID` from a previous process gets nonsense — a large `lastId` matches nothing and
  reports no gap. Version or namespace the id if clients persist it across restarts.
- **`gap` is false for a fresh client.** `lastId <= 0` means "not resuming", so `gap` is only ever
  true for a genuine resume that fell off the buffer.
- **Listener exceptions are swallowed.** `fanOut` wraps each listener in an empty `catch` so one
  bad subscriber cannot break delivery to the others. A throwing listener fails completely
  silently — log inside the listener yourself.
- **Only `progress`, `status`, and `error` events with a `correlationId` enter the snapshot.**
  `log` and `heartbeat` are transient and deliberately excluded, so `snapshot()` never reflects
  them.
- **The snapshot map evicts by recency of write, not by age.** Each update re-inserts the key so
  `Map` iteration order tracks recency, and the oldest-touched key is evicted at `snapshotCap`.
- **`ServerFeedLogger` hard-codes `source: 'log'`** for every mirrored line, so all mirrored logs
  share one source regardless of which subsystem emitted them.
- **`minBusLevel` defaults to `'warn'`.** `info` and `debug` are not mirrored unless you lower it,
  and `trace` is never mirrored at any setting. The rich signal is meant to come from explicit
  `progress`/`status` publishes, not from log volume.
- **Publishing is synchronous.** A slow listener blocks the publisher.
- **`ServerFeed` has no `@Injectable()` decorator.** Register the instance as a value; do not
  `useClass` it.

## Working inside this package

```
src/
  index.ts               Root barrel — event contract + bus
  server.feed.event.ts   The wire contract: levels, kinds, event, filter, levelRank, matches
  server.feed.ts         ServerFeed — ring buffer, snapshot map, fan-out
  logger.ts              Subpath entry for ./logger
  server.feed.logger.ts  ServerFeedLogger and stringifyMessage (module-private)
```

Tests are in `tests/`, mirroring `src/`.

Invariants a change must not break:

- **Nothing reachable from `src/index.ts` may import `@maroonedsoftware/logger`.** It is an
  optional peer; a stray import from the root barrel makes it mandatory for every consumer.
- **No transport, DI, HTTP, or database types in this package**, at any depth. That constraint is
  what lets the same `ServerFeedEvent` type be shared verbatim by the publisher, the SSE
  transport, and a browser console.
- `ServerFeedEvent` is a hand-shared wire contract with no schema codegen behind it. Changing a
  field is a breaking change for every consumer, including ones outside this repo.
- Fan-out must stay exception-isolated.
- A new subpath needs an `exports` entry, a tsup entry in the `build` script, and — if it pulls in
  another package — an entry under `peerDependenciesMeta` marking it optional.

User-visible changes need a changeset in `.changeset/`.
