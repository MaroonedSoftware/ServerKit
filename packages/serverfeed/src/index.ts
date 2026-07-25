/**
 * @maroonedsoftware/serverfeed — a framework-agnostic, in-process realtime feed of server activity: a
 * typed event contract plus a publish/subscribe service with a bounded replay buffer and a
 * latest-per-key snapshot.
 *
 * Transport-free by design. There is no HTTP, DB, DI, logger, or wire-format dependency here;
 * `replaySince` returns the events a reconnecting client missed along with a `gap` flag, and a
 * transport decides how to deliver them. ServerKit ships two thin adapters, both opt-in subpaths
 * so the bare bus loads neither: `@maroonedsoftware/koa/serverfeed` (an SSE feed, built on
 * `@maroonedsoftware/koa`'s SSE module) and `@maroonedsoftware/serverfeed/logger` (a logger bridge,
 * coupled to the logger only structurally so neither package depends on the other).
 */

export * from './server.feed.event.js';
export * from './server.feed.js';
