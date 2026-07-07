/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging */
import { Injectable } from 'injectkit';

/** Default Bot API host used by {@link import('./client/telegram.client.js').TelegramClient}. */
export const TELEGRAM_DEFAULT_API_BASE_URL = 'https://api.telegram.org';

/**
 * Configuration for the Telegram package. Declared as an abstract `@Injectable()`
 * class so it doubles as a DI token (mirrors the `Logger` pattern in
 * `@maroonedsoftware/logger` and `SlackConfig` in `@maroonedsoftware/slack`).
 *
 * Consumers register a concrete value at bootstrap, typically resolved from
 * `AppConfig`:
 *
 * ```ts
 * const telegramConfig = appConfig.getAs<TelegramConfig>('telegram');
 * container.register(TelegramConfig, { useValue: telegramConfig });
 * ```
 *
 * Services in this package take `TelegramConfig` directly in their constructor.
 */
export interface TelegramConfig {
  /** Bot token from BotFather, used in the Bot API URL (`/bot<token>/<method>`). */
  botToken: string;
  /**
   * Secret token to match against the `X-Telegram-Bot-Api-Secret-Token` header.
   * Set the same value via `setWebhook({ secret_token })`. Optional but strongly
   * recommended — it's the only authenticity check Telegram offers for webhooks.
   */
  secretToken?: string;
  /** Bot API base URL. Defaults to {@link TELEGRAM_DEFAULT_API_BASE_URL} (override for a self-hosted Bot API server). */
  apiBaseUrl?: string;
  /**
   * Per-request timeout (in milliseconds) for outbound Bot API calls. Defaults to
   * {@link import('./client/telegram.client.js').TELEGRAM_DEFAULT_REQUEST_TIMEOUT_MS} (10s).
   */
  requestTimeoutMs?: number;
}

@Injectable()
export abstract class TelegramConfig implements TelegramConfig {}
