import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { TelegramConfig, TELEGRAM_DEFAULT_API_BASE_URL } from '../telegram.config.js';
import { TelegramError } from '../telegram.error.js';

/** Default per-request timeout (ms) applied to outbound Bot API calls. */
export const TELEGRAM_DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** Shape of a Bot API response envelope. */
type TelegramApiResponse = {
  ok: boolean;
  result?: unknown;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
};

/** Per-call options for {@link TelegramClient.callMethod}. */
export interface TelegramCallOptions {
  /** Overrides `TelegramConfig.requestTimeoutMs` for this one call. */
  timeoutMs?: number;
}

/** Parameters for `getUpdates`. `timeout` is Telegram's long-poll wait, in SECONDS. */
export interface TelegramGetUpdatesParams {
  offset?: number;
  limit?: number;
  timeout?: number;
  allowed_updates?: string[];
}

/**
 * Thin DI-friendly wrapper around the Telegram Bot API built on `fetch` (no
 * SDK). Constructed once per request scope (or as a singleton, depending on how
 * the consumer registers it) and exposes typed helpers for the most common
 * methods, plus a generic {@link callMethod} escape hatch.
 *
 * Bot API calls return `{ ok, result }`; on `ok: false` (or a non-2xx status)
 * the client throws {@link TelegramError} with the API `description`. A call
 * that never reached Telegram throws one too, with the bot token redacted from
 * everything it carries: the token is part of every URL, and a transport error
 * quoting the URL would otherwise put it in whatever logs the error.
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

  /** The bot's own identity, via `getMe`. The cheapest call that proves the token works. */
  getMe(): Promise<unknown> {
    return this.callMethod('getMe');
  }

  /** The current webhook, via `getWebhookInfo`. A non-empty `url` means `getUpdates` will be refused. */
  getWebhookInfo(): Promise<unknown> {
    return this.callMethod('getWebhookInfo');
  }

  /**
   * Long-polls for updates via `getUpdates`, for a bot with no public address to receive a webhook
   * on. Telegram refuses this while a webhook is set.
   *
   * The call is allowed `params.timeout` seconds of waiting on top of the ordinary request timeout,
   * so a quiet poll that returns empty at the end of its wait is never cut off as a timeout. Pass
   * `offset` as one past the last `update_id` handled, which is also what confirms the earlier ones
   * to Telegram.
   *
   * @returns The array of updates (possibly empty).
   */
  async getUpdates(params: TelegramGetUpdatesParams = {}, options: TelegramCallOptions = {}): Promise<unknown[]> {
    const waitMs = Math.max(0, params.timeout ?? 0) * 1000;
    const timeoutMs = options.timeoutMs ?? waitMs + (this.config.requestTimeoutMs ?? TELEGRAM_DEFAULT_REQUEST_TIMEOUT_MS);
    const result = await this.callMethod('getUpdates', { ...params }, { timeoutMs });
    return Array.isArray(result) ? result : [];
  }

  /**
   * Low-level Bot API call. POSTs JSON to `/bot<token>/<method>`, and throws
   * {@link TelegramError} on a non-2xx status, an `ok: false` envelope, or a
   * transport failure.
   *
   * `internalDetails` carries `method`, `status`, `errorCode`, `description`,
   * and `retryAfter` (seconds) when Telegram said how long to wait.
   *
   * @returns The `result` field of the API response.
   */
  async callMethod(method: string, params: Record<string, unknown> = {}, options: TelegramCallOptions = {}): Promise<unknown> {
    const url = `${this.baseUrl}/bot${this.config.botToken}/${method}`;
    const fetcher = this.config.fetch ?? fetch;

    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(options.timeoutMs ?? this.config.requestTimeoutMs ?? TELEGRAM_DEFAULT_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // Deliberately not `withCause(error)`: the cause's message usually quotes the URL, and the
      // URL holds the token.
      const reason = this.redact(error instanceof Error ? error.message : String(error));
      this.logger.warn('Telegram Bot API call did not reach Telegram', { method, reason });
      throw new TelegramError(`Telegram Bot API call ${method} did not reach Telegram`).withInternalDetails({ method, reason });
    }

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
        description: payload?.description ?? this.redact(text),
        ...(typeof payload?.parameters?.retry_after === 'number' ? { retryAfter: payload.parameters.retry_after } : {}),
      });
    }

    return payload.result;
  }

  /** `text` with the bot token replaced wherever it appears. */
  private redact(text: string): string {
    const token = this.config.botToken;
    return token ? text.split(token).join('<token>') : text;
  }
}
