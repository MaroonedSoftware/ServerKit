/**
 * Gateway intent bits, OR'd together into `GatewayClientOptions.intents`. A
 * const object rather than a TS enum, like `InteractionType`.
 *
 * `MESSAGE_CONTENT` is privileged: enable it in the Developer Portal as well,
 * or the Gateway closes with 4014.
 *
 * @see https://discord.com/developers/docs/events/gateway#gateway-intents
 */
export const Intents = {
  GUILDS: 1 << 0,
  GUILD_MESSAGES: 1 << 9,
  DIRECT_MESSAGES: 1 << 12,
  MESSAGE_CONTENT: 1 << 15,
} as const;

export type Intents = (typeof Intents)[keyof typeof Intents];
