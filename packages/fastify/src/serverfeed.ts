/**
 * `@maroonedsoftware/fastify/serverfeed` — a Fastify SSE adapter for the
 * `@maroonedsoftware/serverfeed` realtime bus. Imported via the `/serverfeed` subpath so base
 * fastify users don't pull in `@maroonedsoftware/serverfeed` (an optional peer dependency).
 *
 * The bus-to-frame handler (`handleServerFeed`, `serverFeedFilterFromQuery`, `ServerFeedContext`)
 * is `@maroonedsoftware/servercore/serverfeed`'s and is re-exported here.
 */

export * from '@maroonedsoftware/servercore/serverfeed';
export * from './serverfeed/server.feed.routes.js';
