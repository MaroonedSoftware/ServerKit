/**
 * `@maroonedsoftware/serverfeed/logger` — a bridge that mirrors qualifying log lines onto the
 * realtime bus. Imported via the `/logger` subpath so users of the bare bus don't load it.
 *
 * `@maroonedsoftware/logger` is an optional peer, needed only here. The bridge lives in this
 * package rather than that one so `@maroonedsoftware/logger` stays standalone.
 */

export * from './server.feed.logger.js';
