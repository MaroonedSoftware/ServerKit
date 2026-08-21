# @maroonedsoftware/serverfeed

## 0.1.5

### Patch Changes

- be035ce: Ship the MIT LICENSE file in the published package tarball, and link to it from the README.
- Updated dependencies [be035ce]
  - @maroonedsoftware/logger@1.1.8

## 0.1.4

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/logger@1.1.7

## 0.1.3

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/logger@1.1.6

## 0.1.2

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/logger@1.1.5

## 0.1.1

### Patch Changes

- Ship `AGENTS.md` in the published tarball.

  Each package now carries an `AGENTS.md` alongside its `README.md`: a machine-oriented guide for AI
  coding agents covering the full export surface, canonical wiring, package-specific rules, and the
  non-obvious failure modes. Adding it to the `files` array means a downstream agent finds it in
  `node_modules` without a network round-trip.

  No runtime code changed.

- Updated dependencies
  - @maroonedsoftware/logger@1.1.4

## 0.1.0

### Minor Changes

- 5e72484: Add `@maroonedsoftware/serverfeed`: a framework-agnostic, transport-free in-process feed of realtime server activity. Publish structured progress/status/log/error/heartbeat events, subscribe with an AND-semantics filter on source, correlation id, minimum level, and kind, and let a reconnecting client catch up from a bounded replay buffer by `Last-Event-ID` (with a `gap` flag when its resume point predates the buffer) or re-seed from a latest-per-key snapshot. An optional `./logger` subpath ships `ServerFeedLogger`, which mirrors qualifying log lines onto the bus.

  `@maroonedsoftware/koa` gains the Server-Sent Events transport that serves it, plus a lifecycle to keep long-lived streams from blocking shutdown:

  - `openSseStream(ctx, options?)` holds an SSE connection open on a Koa context, taking over the raw socket so a client disconnect is not logged as `ERR_STREAM_PREMATURE_CLOSE`. Heartbeats keep the socket and any intermediary proxy warm, and backpressure is tolerated while the socket drains — a client is dropped only once its unflushed buffer passes `maxBufferedBytes` (default 1 MB), so it reconnects and resumes rather than ballooning server memory. `frameEvent` / `frameComment` / `resolveLastEventId` are exported for framing and resume parsing.
  - A new `./serverfeed` subpath serves a `ServerFeed` bus over that transport via `serverFeedRouter()` / `handleServerFeed()`, replaying the backlog from the client's resume point and emitting a `resync` event when that point is too old. `@maroonedsoftware/serverfeed` is an optional peer dependency, needed only for this subpath.
  - `ServerKitModule` gains a `ready` hook that runs after the server reports ready, so background work (pollers, schedulers, cache warms, outbound connections) no longer delays boot; `start` stays for wiring that must exist before the first request. Both hooks now receive an `AbortSignal` that aborts when shutdown begins, also exposed as `builder.lifecycleSignal` for wiring into SSE streams. `builder.whenReady()` resolves once the ready phase finishes.
  - `builder.start(port, options?)` accepts `shutdownGraceMs` (default 10s). `SIGINT`/`SIGTERM` now closes idle connections immediately and force-closes the rest after the grace period, so a long-lived SSE stream or idle keep-alive socket can no longer hold `server.close()` open indefinitely. `shutdown` is idempotent and waits a bounded period for an in-flight `ready` hook to unwind first.

  Existing `start(container)` hooks and `start(port)` calls keep working unchanged.
