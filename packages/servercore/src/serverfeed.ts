/**
 * `@maroonedsoftware/servercore/serverfeed` — the framework-neutral SSE handler for the
 * `@maroonedsoftware/serverfeed` realtime bus. Imported via the `/serverfeed` subpath so base
 * servercore users don't pull in `@maroonedsoftware/serverfeed` (an optional peer dependency).
 * Each HTTP adapter mounts {@link handleServerFeed} on a route of its own.
 */

export * from './serverfeed/server.feed.stream.js';
