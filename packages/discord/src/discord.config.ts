/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import { Injectable } from 'injectkit';

/**
 * Configuration for the Discord package. Declared as an abstract `@Injectable()`
 * class so it doubles as a DI token (mirrors the `Logger` pattern in
 * `@maroonedsoftware/logger` and `SlackConfig` in `@maroonedsoftware/slack`).
 *
 * Consumers register a concrete value at bootstrap, typically resolved from
 * `AppConfig`:
 *
 * ```ts
 * const discordConfig = appConfig.getAs<DiscordConfig>('discord');
 * container.register(DiscordConfig, { useValue: discordConfig });
 * ```
 *
 * Services in this package take `DiscordConfig` directly in their constructor.
 */
export interface DiscordConfig {
  /** Bot token used for REST calls (`Authorization: Bot <token>`). */
  botToken: string;
  /**
   * Application's Ed25519 public key (hex) from the Developer Portal. Used to
   * verify the signature on incoming interaction requests.
   */
  publicKey: string;
  /**
   * Application (client) ID. Required for interaction followups and command
   * registration via {@link import('./client/discord.client.js').DiscordClient}.
   */
  applicationId: string;
  /**
   * Optional maximum age (in seconds) for the interaction request timestamp
   * before signature verification rejects it as a replay. Discord does not
   * mandate a freshness window, so this is **off by default** — only set it if
   * you want replay protection.
   */
  signatureMaxAgeSeconds?: number;
}

@Injectable()
export abstract class DiscordConfig implements DiscordConfig {}
