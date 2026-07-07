/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import { Injectable } from 'injectkit';

/** Default Graph API version used by {@link import('./client/whatsapp.client.js').WhatsAppClient}. */
export const WHATSAPP_DEFAULT_GRAPH_API_VERSION = 'v21.0';

/**
 * Configuration for the WhatsApp package. Declared as an abstract `@Injectable()`
 * class so it doubles as a DI token (mirrors the `Logger` pattern in
 * `@maroonedsoftware/logger` and `SlackConfig` in `@maroonedsoftware/slack`).
 *
 * Consumers register a concrete value at bootstrap, typically resolved from
 * `AppConfig`:
 *
 * ```ts
 * const whatsappConfig = appConfig.getAs<WhatsAppConfig>('whatsapp');
 * container.register(WhatsAppConfig, { useValue: whatsappConfig });
 * ```
 *
 * Services in this package take `WhatsAppConfig` directly in their constructor.
 */
export interface WhatsAppConfig {
  /** Graph API access token (system-user or app token) sent as `Authorization: Bearer`. */
  accessToken: string;
  /** Phone number ID the bot sends from (`POST /{phoneNumberId}/messages`). */
  phoneNumberId: string;
  /** App secret used to verify the `X-Hub-Signature-256` HMAC on incoming webhooks. */
  appSecret: string;
  /** Token echoed during the webhook verification (`GET`) handshake. */
  verifyToken: string;
  /** Graph API version. Defaults to {@link WHATSAPP_DEFAULT_GRAPH_API_VERSION}. */
  graphApiVersion?: string;
  /**
   * Per-request timeout (in milliseconds) for outbound Graph API calls. Defaults to
   * {@link import('./client/whatsapp.client.js').WHATSAPP_DEFAULT_REQUEST_TIMEOUT_MS} (10s).
   */
  requestTimeoutMs?: number;
}

@Injectable()
export abstract class WhatsAppConfig implements WhatsAppConfig {}
