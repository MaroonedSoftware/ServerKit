import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { TelegramConfig, TELEGRAM_DEFAULT_API_BASE_URL } from '../telegram.config.js';
import { TelegramError } from '../telegram.error.js';

/** Default per-request timeout (ms) applied to outbound Bot API calls. */
export const TELEGRAM_DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** Shape of a Bot API response envelope. */
type TelegramApiResponse = { ok: boolean; result?: unknown; description?: string; error_code?: number };

/**
 * Thin DI-friendly wrapper around the Telegram Bot API built on `fetch` (no
 * SDK). Constructed once per request scope (or as a singleton, depending on how
 * the consumer registers it) and exposes typed helpers for the most common
 * methods, plus a generic {@link callMethod} escape hatch.
 *
 * Bot API calls return `{ ok, result }`; on `ok: false` (or a non-2xx status)
 * the client throws {@link TelegramError} with the API `description`.
 *
 * @example
 * ```ts
 * await container.get(TelegramClient).sendMessage({ chat_id: 123, text: 'hello' });
 * await container.get(TelegramClient).answerCallbackQuery({ callback_query_id: 'q1', text: 'Done' });
 * ```
 */
@Injectable()
export class TelegramClient {
  private readonly baseUrl: string;

  constructor(
    private readonly config: TelegramConfig,
    private readonly logger: Logger,
  ) {
    this.baseUrl = config.apiBaseUrl ?? TELEGRAM_DEFAULT_API_BASE_URL;
  }

  /** Sends a message via `sendMessage`. */
  sendMessage(params: Record<string, unknown>): Promise<unknown> {
    return this.callMethod('sendMessage', params);
  }

  /** Answers a callback query via `answerCallbackQuery` (dismisses the inline-button spinner). */
  answerCallbackQuery(params: Record<string, unknown>): Promise<unknown> {
    return this.callMethod('answerCallbackQuery', params);
  }

  /** Registers a webhook via `setWebhook`. Pass `secret_token` to match `TelegramConfig.secretToken`. */
  setWebhook(params: Record<string, unknown>): Promise<unknown> {
    return this.callMethod('setWebhook', params);
  }

  /** Removes the webhook via `deleteWebhook`. */
  deleteWebhook(params: Record<string, unknown> = {}): Promise<unknown> {
    return this.callMethod('deleteWebhook', params);
  }

  /**
   * Low-level Bot API call. POSTs JSON to `/bot<token>/<method>`, and throws
   * {@link TelegramError} on a non-2xx status or an `ok: false` envelope.
   *
   * @returns The `result` field of the API response.
   */
  async callMethod(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const url = `${this.baseUrl}/bot${this.config.botToken}/${method}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? TELEGRAM_DEFAULT_REQUEST_TIMEOUT_MS),
    });

    const text = await response.text().catch(() => '');
    let payload: TelegramApiResponse | undefined;
    try {
      payload = text ? (JSON.parse(text) as TelegramApiResponse) : undefined;
    } catch {
      payload = undefined;
    }

    if (!response.ok || !payload?.ok) {
      this.logger.warn('Telegram Bot API call failed', { method, status: response.status, description: payload?.description });
      throw new TelegramError(`Telegram Bot API call ${method} failed`).withInternalDetails({
        method,
        status: response.status,
        errorCode: payload?.error_code,
        description: payload?.description ?? text,
      });
    }

    return payload.result;
  }
}
