/**
 * `@maroonedsoftware/slack/socketmode` — a Slack Socket Mode client over a
 * socket the caller supplies. Kept off the root barrel so an HTTP-only app
 * never loads it.
 */
export * from './slack.socket.js';
export * from './client/slack.socket.mode.client.js';
