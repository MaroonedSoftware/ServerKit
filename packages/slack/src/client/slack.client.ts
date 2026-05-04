import { Injectable } from 'injectkit';
import { WebClient } from '@slack/web-api';
import type { ChatPostMessageArguments, ChatPostMessageResponse, ChatUpdateArguments, ChatUpdateResponse, ChatDeleteArguments, ChatDeleteResponse, ViewsOpenArguments, ViewsOpenResponse } from '@slack/web-api';
import { Logger } from '@maroonedsoftware/logger';
import { SlackConfig } from '../slack.config.js';
import { SlackError } from '../slack.error.js';
import { adaptLogger } from './slack.logger.adapter.js';

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

  constructor(
    private readonly config: SlackConfig,
    private readonly logger: Logger,
  ) {
    this.web = new WebClient(config.botToken, { logger: adaptLogger(logger) });
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
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.warn('Slack webhook POST returned non-OK status', { status: response.status, body });
      throw new SlackError(`Slack webhook POST returned ${response.status}`).withInternalDetails({ status: response.status, body, url: target });
    }
  }
}
