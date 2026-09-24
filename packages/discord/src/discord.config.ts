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
 * registry.register(DiscordConfig).useValue(discordConfig);
 * ```
 *
 * Services in this package take `DiscordConfig` directly in their constructor.
 */
export interface DiscordConfig {
  /** Bot token used for REST calls (`Authorization: Bot <token>`). */
  botToken: string;
  /**
   * Application's Ed25519 public key (hex) from the Developer Portal. Used to
   * verify the signature on incoming interaction requests. Needed only when Discord calls you over
   * HTTP; a Gateway-only bot can leave it unset, and signature verification then fails closed with
   * `missing_public_key`.
   */
  publicKey?: string;
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
  /**
   * Per-request timeout (in milliseconds) for outbound REST calls. Defaults to
   * {@link import('./client/discord.client.js').DISCORD_DEFAULT_REQUEST_TIMEOUT_MS} (10s).
   */
  requestTimeoutMs?: number;
  /**
   * Base URL for REST calls. Defaults to
   * {@link import('./client/discord.client.js').DISCORD_API_BASE} (`https://discord.com/api/v10`).
   */
  apiBaseUrl?: string;
  /**
   * The `fetch` every REST call goes through. Defaults to the global `fetch`.
   *
   * Set it when the caller owns the transport: a host that routes outbound HTTP through its own
   * allowlist, rate limits or proxy, or a test. The client passes an `AbortSignal` carrying its
   * timeout; an implementation that enforces its own deadline as well may ignore it.
   */
  fetch?: DiscordFetch;
}

/** The subset of `fetch` the client needs: a JSON request, answered with a `Response`. */
export type DiscordFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
) => Promise<Response>;

@Injectable()
export abstract class DiscordConfig implements DiscordConfig {}
