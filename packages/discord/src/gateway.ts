/**
 * `@maroonedsoftware/discord/gateway` — a Discord Gateway client over a socket
 * the caller supplies. Kept off the root barrel so an interactions-only app
 * never loads it.
 */
export * from './discord.socket.js';
export * from './gateway/discord.gateway.intents.js';
export * from './gateway/discord.gateway.client.js';
