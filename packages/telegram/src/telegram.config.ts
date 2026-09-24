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
 * registry.register(TelegramConfig).useValue(telegramConfig);
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
  /**
   * The `fetch` every Bot API call goes through. Defaults to the global `fetch`.
   *
   * Set it when the caller owns the transport: a host that routes outbound HTTP through its own
   * allowlist, rate limits or proxy, or a test. The client passes an `AbortSignal` carrying its
   * timeout; an implementation that enforces its own deadline as well may ignore it.
   */
  fetch?: TelegramFetch;
}

/** The subset of `fetch` the client needs: a POST with a JSON body, answered with a `Response`. */
export type TelegramFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<Response>;

@Injectable()
export abstract class TelegramConfig implements TelegramConfig {}
