import { Injectable } from 'injectkit';
import { WebClient } from '@slack/web-api';
import type {
  WebClientOptions,
  ChatPostMessageArguments,
  ChatPostMessageResponse,
  ChatUpdateArguments,
  ChatUpdateResponse,
  ChatDeleteArguments,
  ChatDeleteResponse,
  ViewsOpenArguments,
  ViewsOpenResponse,
} from '@slack/web-api';
import { Logger } from '@maroonedsoftware/logger';
import { SlackConfig } from '../slack.config.js';
import { SlackError } from '../slack.error.js';
import { adaptLogger } from './slack.logger.adapter.js';

/** Default per-request timeout (ms) applied to outbound `postWebhook` calls. */
export const SLACK_DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * Redacts a Slack webhook / `response_url` so it is safe to log. The final path
 * segment is the secret token (and the query string can carry secrets too), so
 * both are stripped, leaving only the host and path prefix.
 */
export const redactSlackUrl = (raw: string): string => {
  try {
    const url = new URL(raw);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length > 0) segments[segments.length - 1] = '***';
    return `${url.origin}/${segments.join('/')}`;
  } catch {
    return '***';
  }
};

/**
 * Payload for an incoming-webhook POST. Mirrors the subset of fields Slack's
 * incoming webhooks accept (text, blocks, attachments, response shaping).
 * The body is JSON-stringified verbatim, so any extra fields are preserved.
 */
export type IncomingWebhookPayload = {
  text?: string;
  blocks?: unknown[];
  attachments?: unknown[];
  thread_ts?: string;
  response_type?: 'in_channel' | 'ephemeral';
  replace_original?: boolean;
  delete_original?: boolean;
  unfurl_links?: boolean;
  unfurl_media?: boolean;
  [key: string]: unknown;
};

/**
 * Thin DI-friendly wrapper around `@slack/web-api`'s `WebClient`. Constructed
 * once per request scope (or as a singleton, depending on how the consumer
 * registers it) and exposes typed passthroughs for the most common Web API
 * methods plus a `postWebhook` helper for incoming-webhook URLs and the
 * `response_url` returned by slash commands and interactive payloads.
 *
 * Reach for {@link SlackClient.web} directly for anything else the underlying
 * client supports.
 *
 * @example
 * ```ts
 * await container.get(SlackClient).postMessage({ channel: '#ops', text: 'hello' });
 * await container.get(SlackClient).postWebhook({ text: 'follow-up' }, payload.response_url);
 * ```
 */
@Injectable()
export class SlackClient {
  /** Underlying `@slack/web-api` client. */
  readonly web: WebClient;

  /** Web API client authenticated with the app token, built on first use by {@link openSocketModeUrl}. */
  private appWeb?: WebClient;

  constructor(
    private readonly config: SlackConfig,
    private readonly logger: Logger,
  ) {
    this.web = new WebClient(config.botToken, this.webClientOptions());
  }

  /** Options shared by every `WebClient` this class builds, passing only what the config sets. */
  private webClientOptions(): WebClientOptions {
    return {
      logger: adaptLogger(this.logger),
      ...(this.config.fetch ? { fetch: this.config.fetch } : {}),
      ...(this.config.apiBaseUrl ? { slackApiUrl: this.config.apiBaseUrl } : {}),
    };
  }

  /** Posts a message via `chat.postMessage`. */
  postMessage(args: ChatPostMessageArguments): Promise<ChatPostMessageResponse> {
    return this.web.chat.postMessage(args);
  }

  /** Updates a message via `chat.update`. */
  updateMessage(args: ChatUpdateArguments): Promise<ChatUpdateResponse> {
    return this.web.chat.update(args);
  }

  /** Deletes a message via `chat.delete`. */
  deleteMessage(args: ChatDeleteArguments): Promise<ChatDeleteResponse> {
    return this.web.chat.delete(args);
  }

  /** Opens a modal view via `views.open`. */
  openView(args: ViewsOpenArguments): Promise<ViewsOpenResponse> {
    return this.web.views.open(args);
  }

  /**
   * POSTs a payload to a Slack incoming-webhook-style URL — either the
   * configured `incomingWebhookUrl` or an explicit URL (e.g. the
   * `response_url` from a slash command or interactive payload).
   *
   * @throws {@link SlackError} if no URL is available or the response is non-2xx.
   */
  async postWebhook(payload: IncomingWebhookPayload, url?: string): Promise<void> {
    const target = url ?? this.config.incomingWebhookUrl;
    if (!target) {
      throw new SlackError('SlackClient.postWebhook called but no incomingWebhookUrl is configured and no url was provided');
    }
    // `target` is a response_url / incoming-webhook URL whose last path segment
    // is a secret — redact it before it reaches the log or internalDetails.
    const safeUrl = redactSlackUrl(target);
    const fetcher = this.config.fetch ?? fetch;

    let response: Awaited<ReturnType<typeof fetcher>>;
    try {
      response = await fetcher(target, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? SLACK_DEFAULT_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // Deliberately not `withCause(error)`: the cause's message can quote the URL, and the URL
      // holds the secret.
      const reason = (error instanceof Error ? error.message : String(error)).split(target).join(safeUrl);
      this.logger.warn('Slack webhook POST did not reach Slack', { url: safeUrl, reason });
      throw new SlackError('Slack webhook POST did not reach Slack').withInternalDetails({ url: safeUrl, reason });
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn('Slack webhook POST returned non-OK status', { status: response.status, body, url: safeUrl });
      throw new SlackError(`Slack webhook POST returned ${response.status}`).withInternalDetails({ status: response.status, body, url: safeUrl });
    }
  }

  /**
   * Opens a Socket Mode connection slot via `apps.connections.open` and returns the WebSocket URL
   * to connect to. Authenticates with `appToken`, not the bot token, over the same `fetch` and base
   * URL as every other call. Each URL is single-use, so call this again for every reconnect.
   *
   * @throws {@link SlackError} if `appToken` is not configured or Slack does not hand back a URL.
   */
  async openSocketModeUrl(): Promise<string> {
    const appToken = this.config.appToken;
    if (!appToken) {
      throw new SlackError('SlackClient.openSocketModeUrl called but no appToken (xapp-...) is configured');
    }
    this.appWeb ??= new WebClient(appToken, this.webClientOptions());

    let result: { ok?: boolean; url?: string; error?: string };
    try {
      result = await this.appWeb.apps.connections.open();
    } catch (error) {
      // The SDK throws on `ok: false`, carrying Slack's error code in `data.error`. Its errors do
      // not quote the token, but only the code and message are kept, to be safe.
      const code = (error as { data?: { error?: unknown } }).data?.error;
      const reason = error instanceof Error ? error.message.split(appToken).join('<token>') : String(error);
      this.logger.warn('Slack apps.connections.open failed', { error: code, reason });
      throw new SlackError('Slack apps.connections.open failed').withInternalDetails({ error: code, reason });
    }

    if (!result.ok || !result.url) {
      this.logger.warn('Slack apps.connections.open returned no URL', { error: result.error });
      throw new SlackError('Slack apps.connections.open returned no URL').withInternalDetails({ error: result.error });
    }
    return result.url;
  }
}
