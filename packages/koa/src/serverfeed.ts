/**
 * `@maroonedsoftware/koa/serverfeed` — a koa SSE adapter for the
 * `@maroonedsoftware/serverfeed` realtime bus. Imported via the `/serverfeed` subpath so base
 * koa users don't pull in `@maroonedsoftware/serverfeed` (an optional peer dependency).
 */

export * from './serverfeed/server.feed.stream.js';
